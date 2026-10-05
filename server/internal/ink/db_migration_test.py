import sqlite3
import tempfile
import unittest
from pathlib import Path

from db_migration import migrate_legacy_database


class LegacyDatabaseMigrationTests(unittest.TestCase):
    def test_backup_migrates_existing_state_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            legacy = root / "Inkway" / "microloop" / "decisions.db"
            legacy.parent.mkdir(parents=True)
            connection = sqlite3.connect(legacy)
            connection.execute("CREATE TABLE proof(value TEXT)")
            connection.execute("INSERT INTO proof VALUES ('persisted')")
            connection.execute("PRAGMA user_version=4")
            connection.commit()
            connection.close()

            target = root / "Inkway" / "ink" / "decisions.db"
            self.assertEqual(migrate_legacy_database(target), str(target))
            migrated = sqlite3.connect(target)
            self.assertEqual(migrated.execute("SELECT value FROM proof").fetchone()[0], "persisted")
            self.assertEqual(migrated.execute("PRAGMA user_version").fetchone()[0], 4)
            migrated.close()
            self.assertTrue(legacy.is_file())

            # Existing Ink state always wins on subsequent startups.
            self.assertEqual(migrate_legacy_database(target), str(target))
            migrated = sqlite3.connect(target)
            self.assertEqual(migrated.execute("SELECT count(*) FROM proof").fetchone()[0], 1)
            migrated.close()

    def test_finds_original_issuway_app_support_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = root / "Issuway" / "microloop" / "decisions.db"
            old.parent.mkdir(parents=True)
            connection = sqlite3.connect(old)
            connection.execute("CREATE TABLE proof(value TEXT)")
            connection.execute("INSERT INTO proof VALUES ('old install')")
            connection.commit()
            connection.close()
            target = root / "Inkway" / "ink" / "decisions.db"

            migrate_legacy_database(target)

            migrated = sqlite3.connect(target)
            self.assertEqual(migrated.execute("SELECT value FROM proof").fetchone()[0], "old install")
            migrated.close()


if __name__ == "__main__":
    unittest.main()
