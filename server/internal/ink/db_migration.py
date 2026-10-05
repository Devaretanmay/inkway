"""Safe upgrade of the old app-support decision database location."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path


def migrate_legacy_database(target: str | Path) -> str:
    """Atomically copy an existing decision DB into Inkway's Ink state folder.

    The source is opened read-only through SQLite's backup API, which includes
    committed WAL records. The original DB and sidecars are left untouched.
    """
    destination = Path(target).expanduser()
    if destination.exists():
        return str(destination)

    inkway_data = destination.parent.parent
    app_data = inkway_data.parent
    candidates = [inkway_data / "microloop" / "decisions.db"]
    candidates.extend(
        app_data / old_name / "microloop" / "decisions.db"
        for old_name in ("Issuway", "Microloop", "Multica")
    )
    source_path = next((path for path in candidates if path.is_file()), None)
    if source_path is None:
        return str(destination)

    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".ink-db-migration-", dir=destination.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    source = sqlite3.connect(f"file:{source_path.resolve()}?mode=ro", uri=True)
    output = sqlite3.connect(temporary)
    try:
        source.backup(output)
        result = output.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise sqlite3.DatabaseError("legacy Ink state failed integrity verification")
        source_version = source.execute("PRAGMA user_version").fetchone()[0]
        target_version = output.execute("PRAGMA user_version").fetchone()[0]
        if source_version != target_version:
            raise sqlite3.DatabaseError("legacy Ink state version changed during copy")
        output.close()
        source.close()
        os.replace(temporary, destination)
    except BaseException:
        output.close()
        source.close()
        temporary.unlink(missing_ok=True)
        raise
    return str(destination)
