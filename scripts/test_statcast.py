import json
import tempfile
import unittest
from pathlib import Path

from update_statcast import PREFIX, normalize, update


class StatcastTests(unittest.TestCase):
    def test_missing_is_not_zero(self):
        result = normalize([{"player_id": "123", "xwoba": "0", "xba": ""}], "percentiles")
        self.assertEqual(result, {"123": {"xwoba": 0}})

    def test_signed_run_values(self):
        self.assertEqual(normalize([{"player_id": "123", "runner_runs_tot": "-4.2"}], "baserunning"), {"123": {"baserunningRunValue": -4.2}})

    def test_reject_ambiguous_columns_and_splits(self):
        with self.assertRaises(ValueError):
            normalize([{"player_id": "123", "runs": "10"}], "fielding")
        with self.assertRaises(ValueError):
            normalize([{"player_id": "123", "run_value": "1"}] * 2, "batting")

    def test_failed_downloads_keep_file_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "snapshot.js"
            previous = PREFIX + json.dumps({"seasons": {"2026": {"sources": {"batting": {"players": {"123": {"battingRunValue": 12}}, "updatedAt": "2026-06-01"}}}}}) + ";\n"
            path.write_text(previous, encoding="utf-8")
            def blocked(url):
                raise PermissionError("403")
            self.assertEqual(update(2026, path, blocked), 0)
            self.assertEqual(path.read_text(encoding="utf-8"), previous)

    def test_partial_success_preserves_other_sources_and_seasons(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "snapshot.js"
            previous = {"seasons": {"2025": {"sources": {}}, "2026": {"sources": {"fielding": {"players": {"123": {"fieldingRunValue": 2}}, "updatedAt": "2026-06-01"}}}}}
            path.write_text(PREFIX + json.dumps(previous) + ";\n", encoding="utf-8")
            def partial(url):
                if "swing-take" in url:
                    return [{"player_id": "123", "run_value": "4", "year": "2026"}]
                raise PermissionError("403")
            self.assertEqual(update(2026, path, partial), 2)
            payload = json.loads(path.read_text()[len(PREFIX):].strip().removesuffix(";"))
            self.assertIn("2025", payload["seasons"])
            self.assertEqual(payload["seasons"]["2026"]["sources"]["fielding"], previous["seasons"]["2026"]["sources"]["fielding"])

    def test_wrong_season_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "snapshot.js"
            self.assertEqual(update(2026, path, lambda url: [{"player_id": "123", "year": "2025", "run_value": "4"}]), 0)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()

