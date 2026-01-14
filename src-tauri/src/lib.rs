use tauri::Manager;
use tauri::path::BaseDirectory;
use std::fs;

#[tauri::command]
fn load_model_fbx_from_zip(app: tauri::AppHandle, zip_filename: String) -> Result<Vec<u8>, String> {
    use std::io::Read;

    fn read_zip_entry(zip_path: &std::path::Path) -> Result<Vec<u8>, String> {
        let file = fs::File::open(zip_path)
            .map_err(|e| format!("Failed to open zip file {:?}: {}", zip_path, e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read zip archive {:?}: {}", zip_path, e))?;

        // Pick the first .fbx entry (keeps API simple; supports current assets).
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read zip entry {} in {:?}: {}", i, zip_path, e))?;
            let name = entry.name().to_string();
            if !name.to_lowercase().ends_with(".fbx") {
                continue;
            }
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read FBX entry {} in {:?}: {}", name, zip_path, e))?;
            return Ok(buf);
        }

        Err(format!(
            "No .fbx entry found in zip {:?}",
            zip_path
        ))
    }

    // 1) Dev Mode: read directly from repo folder.
    #[cfg(debug_assertions)]
    {
        use std::path::PathBuf;
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?;
        let mut dev_path = PathBuf::from(manifest_dir);
        dev_path.push("resources/models");
        dev_path.push(&zip_filename);
        if dev_path.exists() {
            return read_zip_entry(&dev_path);
        }
    }

    // 2) Production: resolve from bundled resources.
    let maybe_paths = vec![
        format!("resources/models/{}", zip_filename),
        format!("resources/{}", zip_filename),
        format!("models/{}", zip_filename),
        zip_filename.clone(),
    ];

    for path_str in maybe_paths {
        if let Ok(path) = app.path().resolve(&path_str, BaseDirectory::Resource) {
            if path.exists() {
                return read_zip_entry(&path);
            }
        }
    }

    Err(format!(
        "Could not find model zip {} in resources",
        zip_filename
    ))
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn load_audio_asset(app: tauri::AppHandle, filename: String) -> Result<Vec<u8>, String> {
    // 1. Dev Mode Fallback: Check directly in the project folder
    #[cfg(debug_assertions)]
    {
        use std::path::PathBuf;

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?;
        let mut dev_path = PathBuf::from(manifest_dir);
        // Adjusted for new structure: src-tauri/resources/audio
        dev_path.push("resources/audio");
        dev_path.push(&filename);
        
        if dev_path.exists() {
             return fs::read(&dev_path).map_err(|e| format!("Failed to read file from dev path {:?}: {}", dev_path, e));
        }
    }

    // 2. Production / Standard Resource Mode
    let maybe_paths = vec![
        format!("resources/audio/{}", filename), 
        format!("resources/{}", filename),       
        format!("audio/{}", filename),           
        filename.clone(), 
    ];

    for path_str in maybe_paths {
         match app.path().resolve(&path_str, BaseDirectory::Resource) {
            Ok(path) => {
                if path.exists() {
                     return fs::read(&path).map_err(|e| format!("Failed to read file at {:?}: {}", path, e));
                }
            },
            Err(_) => {},
         }
    }
    
    Err(format!("Could not find audio file {} in resources", filename))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![greet, load_audio_asset, load_model_fbx_from_zip])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
