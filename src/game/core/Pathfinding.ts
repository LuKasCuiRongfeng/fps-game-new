import * as THREE from 'three';
import { MapConfig } from './GameConfig';

interface Node {
    x: number;
    z: number;
    walkable: boolean;
    weight: number; // Added weight for cost calculation
    gCost: number;
    hCost: number;
    parent: Node | null;

    // Per-search bookkeeping (perf): avoids full-grid resets and expensive Set/includes.
    runId: number;
    openedId: number;
    closedId: number;
}

export class Pathfinding {
    private grid: Node[][] = [];
    // World-scale grid. We use a coarse cell size so A* stays cheap.
    private cellSize: number = 20; // meters per cell (perf: fewer nodes per search)
    private worldRadius: number = MapConfig.boundaryRadius + 25; // include a margin
    private gridSize: number = 0;
    private offset: number = 0;
    private waypoints: { bottom: THREE.Vector3, top: THREE.Vector3 }[] = [];

    private searchId: number = 1;

    constructor(objects: THREE.Object3D[]) {
        this.configureGrid();
        this.initGrid();
        this.bakeObstacles(objects);
        this.parseWaypoints(objects);
    }

    private configureGrid() {
        // +1 so edges are inclusive, and keep a centered origin.
        this.gridSize = Math.ceil((this.worldRadius * 2) / this.cellSize) + 1;
        this.offset = Math.floor(this.gridSize / 2);
    }

    private parseWaypoints(objects: THREE.Object3D[]) {
        const bottoms: {[key: number]: THREE.Vector3} = {};
        const tops: {[key: number]: THREE.Vector3} = {};

        const tmp = new THREE.Vector3();

        for(const obj of objects) {
            if(obj.userData.isWayPoint) {
                const wpPos = obj.getWorldPosition(tmp).clone();
                if(obj.userData.type === 'stair_bottom') bottoms[obj.userData.id] = wpPos;
                if(obj.userData.type === 'stair_top') tops[obj.userData.id] = wpPos;
            }
        }
        
        // Pair them
        for(const id in bottoms) {
            if(tops[id]) {
                this.waypoints.push({ bottom: bottoms[id], top: tops[id] });
            }
        }
    }

    private initGrid() {
        this.grid = [];
        for (let x = 0; x < this.gridSize; x++) {
            this.grid[x] = [];
            for (let z = 0; z < this.gridSize; z++) {
                this.grid[x][z] = {
                    x: x,
                    z: z,
                    walkable: true,
                    weight: 1, // Default weight
                    gCost: Infinity,
                    hCost: 0,
                    parent: null,
                    runId: 0,
                    openedId: 0,
                    closedId: 0,
                };
            }
        }
    }

    private prepareNode(node: Node, runId: number) {
        if (node.runId === runId) return;
        node.runId = runId;
        node.gCost = Infinity;
        node.hCost = 0;
        node.parent = null;
        // openedId/closedId are compared against runId; no need to reset here.
    }

    private bakeObstacles(objects: THREE.Object3D[]) {
        // Simple rasterization of bounding boxes onto the grid
        for (const obj of objects) {
            if (obj.userData.isGround) continue;
            if (obj.userData.isWayPoint) continue; // Skip waypoints
            
            const isStair = obj.userData.isStair === true;

            // Ensure transforms are up to date before computing world-space bounds.
            obj.updateWorldMatrix(true, true);

            const box = new THREE.Box3().setFromObject(obj);
            
            if (box.isEmpty()) continue; // Skip objects with no geometry (like empty waypoints if they slipped through)

            // Expand box slightly for enemy radius (0.5)
            box.expandByScalar(0.5);

            // Convert box min/max to grid coordinates
            const minX = Math.floor(box.min.x / this.cellSize + this.offset);
            const maxX = Math.ceil(box.max.x / this.cellSize + this.offset);
            const minZ = Math.floor(box.min.z / this.cellSize + this.offset);
            const maxZ = Math.ceil(box.max.z / this.cellSize + this.offset);

            for (let x = minX; x < maxX; x++) {
                for (let z = minZ; z < maxZ; z++) {
                    if (this.isValid(x, z)) {
                        if (isStair) {
                            // Mark stairs as slightly higher cost to prefer flat ground
                            // But not too high to prevent usage
                            this.grid[x][z].weight = 2; 
                        } else {
                            // Mark other obstacles as unwalkable
                            this.grid[x][z].walkable = false;
                        }
                    }
                }
            }
        }
    }

    private isValid(x: number, z: number): boolean {
        return x >= 0 && x < this.gridSize && z >= 0 && z < this.gridSize;
    }

    private findNearestWalkableNode(from: Node, maxRadiusCells: number): Node | null {
        if (from.walkable) return from;

        // Expanding ring search around the target node.
        // This is more robust than only checking the immediate 8 neighbors.
        for (let r = 1; r <= maxRadiusCells; r++) {
            const minX = from.x - r;
            const maxX = from.x + r;
            const minZ = from.z - r;
            const maxZ = from.z + r;

            // Top/bottom edges
            for (let x = minX; x <= maxX; x++) {
                if (this.isValid(x, minZ) && this.grid[x][minZ].walkable) return this.grid[x][minZ];
                if (this.isValid(x, maxZ) && this.grid[x][maxZ].walkable) return this.grid[x][maxZ];
            }

            // Left/right edges (skip corners, already checked)
            for (let z = minZ + 1; z <= maxZ - 1; z++) {
                if (this.isValid(minX, z) && this.grid[minX][z].walkable) return this.grid[minX][z];
                if (this.isValid(maxX, z) && this.grid[maxX][z].walkable) return this.grid[maxX][z];
            }
        }

        return null;
    }

    public findPath(startPos: THREE.Vector3, endPos: THREE.Vector3): THREE.Vector3[] {
        let finalTargetPos = endPos;

        const distXZ = (a: THREE.Vector3, b: THREE.Vector3) => {
            const dx = a.x - b.x;
            const dz = a.z - b.z;
            return Math.sqrt(dx * dx + dz * dz);
        };

        // Heuristic for Vertical Navigation (Stairs)
        // If height difference is significant (> 2.0m)
        if (Math.abs(startPos.y - endPos.y) > 2.0) {
            let bestWaypoint = null;
            let minDistance = Infinity;

            // Going UP
            if (endPos.y > startPos.y) {
                // Find the stair that best connects to the target.
                // Prefer horizontal proximity (XZ) and treat the target as "on the top" if its Y
                // is close to the waypoint top Y (player standing on the stair platform).
                const onTopLevelTolerance = 2.0;
                const isTargetOnSomeTop = this.waypoints.some(wp => Math.abs(endPos.y - wp.top.y) < onTopLevelTolerance);

                // Find stair TOP closest to TARGET (XZ)
                for (const wp of this.waypoints) {
                    const dist = distXZ(wp.top, endPos);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestWaypoint = wp;
                    }
                }

                if (bestWaypoint) {
                    // Only use stairs if it makes sense.
                    // If the target is on the stair platform level, ALWAYS allow stairs.
                    // Otherwise, keep a conservative check to avoid false positives (player on a random tall prop).
                    const targetLooksOnTop = Math.abs(endPos.y - bestWaypoint.top.y) < onTopLevelTolerance;
                    const shouldUseStairs = targetLooksOnTop || (!isTargetOnSomeTop && endPos.distanceTo(bestWaypoint.top) < endPos.distanceTo(bestWaypoint.bottom));

                    if (shouldUseStairs) {
                         // We decided to use stairs.
                         // Now, do we go to the bottom (entry) or top (exit)?

                         // IMPORTANT:
                         // Don't use startPos.y to decide whether we're "at" the bottom level.
                         // Enemy Y follows terrain and can vary by >2m even on the same navigable level,
                         // causing enemies to incorrectly target the stair TOP and run under the platform.
                         // Use horizontal proximity to the stair entry instead.
                         const distToBottomXZ = distXZ(startPos, bestWaypoint.bottom);
                         const distToTopXZ = distXZ(startPos, bestWaypoint.top);

                         // If we're already close to the top (e.g., we already climbed), go to top.
                         // Otherwise, approach the bottom entry first, then switch to top once close.
                         const entryReachRadius = Math.max(4.0, this.cellSize * 0.5);
                         if (distToTopXZ <= entryReachRadius) {
                             finalTargetPos = bestWaypoint.top;
                         } else if (distToBottomXZ > entryReachRadius) {
                             finalTargetPos = bestWaypoint.bottom;
                         } else {
                             finalTargetPos = bestWaypoint.top;
                         }
                    }
                }
            } 
            // Going DOWN
            else {
                // Find stair TOP closest to START (me)
                for (const wp of this.waypoints) {
                    const dist = wp.top.distanceTo(startPos);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestWaypoint = wp;
                    }
                }

                if (bestWaypoint) {
                    // Only use stairs if target is closer to the Bottom than the Top
                    const onBottomLevelTolerance = 2.0;
                    const targetLooksOnBottom = Math.abs(endPos.y - bestWaypoint.bottom.y) < onBottomLevelTolerance;
                    const shouldUseStairs = targetLooksOnBottom || (endPos.distanceTo(bestWaypoint.bottom) < endPos.distanceTo(bestWaypoint.top));

                    if (shouldUseStairs) {
                        // We decided to use stairs.
                        // Now, do we go to the top (entry) or bottom (exit)?

                        // Same rationale as Going UP: use horizontal proximity rather than Y.
                        const distToBottomXZ = distXZ(startPos, bestWaypoint.bottom);
                        const distToTopXZ = distXZ(startPos, bestWaypoint.top);

                        const entryReachRadius = Math.max(4.0, this.cellSize * 0.5);
                        if (distToBottomXZ <= entryReachRadius) {
                            finalTargetPos = bestWaypoint.bottom;
                        } else if (distToTopXZ > entryReachRadius) {
                            finalTargetPos = bestWaypoint.top;
                        } else {
                            finalTargetPos = bestWaypoint.bottom;
                        }
                    }
                }
            }
        }

        const startNode = this.getNodeFromWorldPos(startPos);
        const endNode = this.getNodeFromWorldPos(finalTargetPos);

        if (!startNode || !endNode) {
            return [];
        }

        // If start is unwalkable (can happen if we spawned inside/overlapping an obstacle cell),
        // snap to a nearby walkable node.
        const startWalkable = this.findNearestWalkableNode(startNode, 6);
        if (!startWalkable) return [];
 
        // If target is unwalkable (common for waypoint points inside geometry),
        // snap to the nearest walkable node within a small radius.
        const targetWalkable = this.findNearestWalkableNode(endNode, 8);
        if (!targetWalkable) return [];
        
        let targetNode = targetWalkable;

        const runId = ++this.searchId;

        // Prepare and seed start/target nodes for this search.
        this.prepareNode(startWalkable, runId);
        this.prepareNode(targetNode, runId);

        startWalkable.gCost = 0;
        startWalkable.hCost = this.getDistance(startWalkable, targetNode);

        const openSet: Node[] = [startWalkable];
        startWalkable.openedId = runId;
        startWalkable.closedId = 0;

        while (openSet.length > 0) {
            // Find node with lowest fCost
            let currentNode = openSet[0];
            for (let i = 1; i < openSet.length; i++) {
                if (this.getFCost(openSet[i]) < this.getFCost(currentNode) || 
                    (this.getFCost(openSet[i]) === this.getFCost(currentNode) && openSet[i].hCost < currentNode.hCost)) {
                    currentNode = openSet[i];
                }
            }

            openSet.splice(openSet.indexOf(currentNode), 1);
            currentNode.closedId = runId;

            if (currentNode === targetNode) {
                return this.retracePath(startWalkable, targetNode);
            }

            for (const neighbor of this.getNeighbors(currentNode)) {
                if (!neighbor.walkable || neighbor.closedId === runId) {
                    continue;
                }

                this.prepareNode(neighbor, runId);

                // Calculate cost to neighbor including weight
                // Distance is usually 10 (straight) or 14 (diagonal)
                // We multiply by neighbor.weight to make difficult terrain expensive
                const dist = this.getDistance(currentNode, neighbor);
                const weightedDist = dist * neighbor.weight;
                
                const newMovementCostToNeighbor = currentNode.gCost + weightedDist;
                
                if (newMovementCostToNeighbor < neighbor.gCost || neighbor.openedId !== runId) {
                    neighbor.gCost = newMovementCostToNeighbor;
                    neighbor.hCost = this.getDistance(neighbor, targetNode);
                    neighbor.parent = currentNode;

                    if (neighbor.openedId !== runId) {
                        openSet.push(neighbor);
                        neighbor.openedId = runId;
                    }
                }
            }
        }

        return [];
    }

    private getFCost(node: Node): number {
        return node.gCost + node.hCost;
    }

    private retracePath(startNode: Node, endNode: Node): THREE.Vector3[] {
        const path: THREE.Vector3[] = [];
        let currentNode: Node | null = endNode;

        while (currentNode !== startNode && currentNode !== null) {
            path.push(this.getWorldPosFromNode(currentNode));
            currentNode = currentNode.parent;
        }
        
        return path.reverse();
    }

    private getNeighbors(node: Node): Node[] {
        const neighbors: Node[] = [];

        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                if (x === 0 && z === 0) continue;

                const checkX = node.x + x;
                const checkZ = node.z + z;

                if (this.isValid(checkX, checkZ)) {
                    neighbors.push(this.grid[checkX][checkZ]);
                }
            }
        }

        return neighbors;
    }

    private getDistance(nodeA: Node, nodeB: Node): number {
        const dstX = Math.abs(nodeA.x - nodeB.x);
        const dstZ = Math.abs(nodeA.z - nodeB.z);

        if (dstX > dstZ)
            return 14 * dstZ + 10 * (dstX - dstZ);
        return 14 * dstX + 10 * (dstZ - dstX);
    }

    private getNodeFromWorldPos(worldPos: THREE.Vector3): Node | null {
        const x = Math.round(worldPos.x / this.cellSize + this.offset);
        const z = Math.round(worldPos.z / this.cellSize + this.offset);
        
        if (this.isValid(x, z)) {
            return this.grid[x][z];
        }
        return null;
    }

    private getWorldPosFromNode(node: Node): THREE.Vector3 {
        // Y坐标设为0，敌人会根据实际地形高度自动调整
        return new THREE.Vector3(
            (node.x - this.offset) * this.cellSize,
            0, 
            (node.z - this.offset) * this.cellSize
        );
    }
    
    /**
     * 获取楼梯路径点信息，用于调试
     */
    public getWaypoints() {
        return this.waypoints;
    }
}
