use crate::db::{apply_sync_changes, create_database};
use crate::sync;

pub fn sync_db(tag: &sync::Tag) -> Result<Vec<(String, String)>, String> {
    create_database()?;

    let (compute, deleted, tags_to_add, tags_to_remove) =
        sync::sync(tag).map_err(|error| format!("Failed to calculate sync changes: {}", error))?;

    // Send to IDE Extension to compute embeddings
    let hashes_to_remove = deleted
        .into_iter()
        .map(|(_, hash)| hash)
        .collect::<Vec<_>>();
    let hashes_to_tag = tags_to_add
        .into_iter()
        .map(|(_, hash)| hash)
        .collect::<Vec<_>>();
    let hashes_to_untag = tags_to_remove
        .into_iter()
        .map(|(_, hash)| hash)
        .collect::<Vec<_>>();

    let tag_name = tag.to_string();
    apply_sync_changes(
        &hashes_to_remove,
        &hashes_to_tag,
        &hashes_to_untag,
        &tag_name,
    )?;

    Ok(compute)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_nothing_fails() {
        let tag = &sync::Tag {
            dir: Path::new("../extensions/vscode"),
            branch: "main",
            provider_id: "test",
        };
        sync_db(tag).unwrap();
    }
}
