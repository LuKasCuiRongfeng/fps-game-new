import * as THREE from 'three';

interface Node {
    x: number;
    z: number;
    walkable: boolean;
    weight: number; // Added weight for cost calculation
    gCost: number;
    hCost: number;
    parent: Node | null;
}

export class Pathfinding {
    private grid: Node[][] = [];
    private gridSize: number = 50; // 50x50 area
    private offset: number = 25; // To map -25..25 to 0..50
    private waypoints: { bottom: THREE.Vector3, top: THREE.Vector3 }[] = [];

    constructor(objects: THREE.Object3D[]) {
        this.initGrid();
        this.bakeObstacles(objects);
        this.parseWaypoints(objects);
    }

    private parseWaypoints(objects: THREE.Object3D[]) {
        const bottoms: {[key: number]: THREE.Vector3} = {};
        const tops: {[key: number]: THREE.Vector3} = {};

        for(const obj of objects) {
            if(obj.userData.isWayPoint) {
                if(obj.userData.type === 'stair_bottom') bottoms[obj.userData.id] = obj.position.clone();
                if(obj.userData.type === 'stair_top') tops[obj.userData.id] = obj.position.clone();
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
                    gCost: 0,
                    hCost: 0,
                    parent: null
                };
            }
        }
    }

    private bakeObstacles(objects: THREE.Object3D[]) {
        // Simple rasterization of bounding boxes onto the grid
        for (const obj of objects) {
            if (obj.userData.isGround) continue;
            if (obj.userData.isWayPoint) continue; // Skip waypoints
            
            const isStair = obj.userData.isStair === true;

            const box = new THREE.Box3().setFromObject(obj);
            
            if (box.isEmpty()) continue; // Skip objects with no geometry (like empty waypoints if they slipped through)

            // Expand box slightly for enemy radius (0.5)
            box.expandByScalar(0.5);

            // Convert box min/max to grid coordinates
            const minX = Math.floor(box.min.x + this.offset);
            const maxX = Math.ceil(box.max.x + this.offset);
            const minZ = Math.floor(box.min.z + this.offset);
            const maxZ = Math.ceil(box.max.z + this.offset);

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

    public findPath(startPos: THREE.Vector3, endPos: THREE.Vector3): THREE.Vector3[] {
        let finalTargetPos = endPos;

        // Calculate horizontal distance
        const horizontalDist = new THREE.Vector2(startPos.x, startPos.z).distanceTo(new THREE.Vector2(endPos.x, endPos.z));

        // Heuristic for Vertical Navigation (Stairs)
        // If height difference is significant (> 2.0m)
        if (Math.abs(startPos.y - endPos.y) > 2.0) {
            let bestWaypoint = null;
            let minDistance = Infinity;

            // Going UP
            if (endPos.y > startPos.y) {
                // Find stair TOP closest to TARGET
                for (const wp of this.waypoints) {
                    const dist = wp.top.distanceTo(endPos);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestWaypoint = wp;
                    }
                }

                if (bestWaypoint) {
                    // Only use stairs if target is closer to the Top than the Bottom
                    // This prevents enemies from running to stairs when the player is just on a tall box nearby
                    if (endPos.distanceTo(bestWaypoint.top) < endPos.distanceTo(bestWaypoint.bottom)) {
                         // We decided to use stairs.
                         // Now, do we go to the bottom (entry) or top (exit)?
                         
                         // If we are at the bottom level AND far from the entry, go to entry first.
                         const distToBottom = startPos.distanceTo(bestWaypoint.bottom);
                         const isAtBottomLevel = Math.abs(startPos.y - bestWaypoint.bottom.y) < 2.0;

                         if (isAtBottomLevel && distToBottom > 2.0) {
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
                    if (endPos.distanceTo(bestWaypoint.bottom) < endPos.distanceTo(bestWaypoint.top)) {
                        // We decided to use stairs.
                        // Now, do we go to the top (entry) or bottom (exit)?

                        // If we are at the top level AND far from the entry, go to entry first.
                        const distToTop = startPos.distanceTo(bestWaypoint.top);
                        const isAtTopLevel = Math.abs(startPos.y - bestWaypoint.top.y) < 2.0;

                        if (isAtTopLevel && distToTop > 2.0) {
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
        
        // If target is unwalkable, find nearest walkable neighbor
        let targetNode = endNode;
        if (!targetNode.walkable) {
             const neighbors = this.getNeighbors(targetNode);
             let bestNeighbor = null;
             let minDist = Infinity;
             for(const n of neighbors) {
                 if(n.walkable) {
                     const d = this.getDistance(n, startNode);
                     if(d < minDist) {
                         minDist = d;
                         bestNeighbor = n;
                     }
                 }
             }
             if(bestNeighbor) targetNode = bestNeighbor;
             else return []; // Can't reach
        }

        const openSet: Node[] = [];
        const closedSet: Set<Node> = new Set();

        openSet.push(startNode);

        // Reset costs (optimization: use a run ID instead of full reset?)
        // For 50x50 grid, full reset is fast enough
        for(let x=0; x<this.gridSize; x++) {
            for(let z=0; z<this.gridSize; z++) {
                const node = this.grid[x][z];
                node.gCost = 0;
                node.hCost = 0;
                node.parent = null;
            }
        }

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
            closedSet.add(currentNode);

            if (currentNode === targetNode) {
                return this.retracePath(startNode, targetNode);
            }

            for (const neighbor of this.getNeighbors(currentNode)) {
                if (!neighbor.walkable || closedSet.has(neighbor)) {
                    continue;
                }

                // Calculate cost to neighbor including weight
                // Distance is usually 10 (straight) or 14 (diagonal)
                // We multiply by neighbor.weight to make difficult terrain expensive
                const dist = this.getDistance(currentNode, neighbor);
                const weightedDist = dist * neighbor.weight;
                
                const newMovementCostToNeighbor = currentNode.gCost + weightedDist;
                
                if (newMovementCostToNeighbor < neighbor.gCost || !openSet.includes(neighbor)) {
                    neighbor.gCost = newMovementCostToNeighbor;
                    neighbor.hCost = this.getDistance(neighbor, targetNode);
                    neighbor.parent = currentNode;

                    if (!openSet.includes(neighbor)) {
                        openSet.push(neighbor);
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
        const x = Math.round(worldPos.x + this.offset);
        const z = Math.round(worldPos.z + this.offset);
        
        if (this.isValid(x, z)) {
            return this.grid[x][z];
        }
        return null;
    }

    private getWorldPosFromNode(node: Node): THREE.Vector3 {
        // Y坐标设为0，敌人会根据实际地形高度自动调整
        return new THREE.Vector3(
            node.x - this.offset,
            0, 
            node.z - this.offset
        );
    }
    
    /**
     * 获取楼梯路径点信息，用于调试
     */
    public getWaypoints() {
        return this.waypoints;
    }
}
