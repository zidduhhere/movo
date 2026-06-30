fn main() {
    let env_path = std::path::Path::new(".env");
    if let Ok(contents) = std::fs::read_to_string(env_path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let clean_key = key.trim().strip_prefix("export ").unwrap_or(key.trim()).trim();
                println!("cargo:rustc-env={}={}", clean_key, value.trim().trim_matches('"').trim_matches('\''));
            }
        }
    }

    tauri_build::build()
}
