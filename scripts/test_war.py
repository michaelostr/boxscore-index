import tempfile
import json
import unittest
from pathlib import Path
from update_war import normalize, update, backfill, PREFIX, ROOT


class WarTests(unittest.TestCase):
    def test_zero_and_wrong_season(self):
        self.assertEqual(normalize([{"mlb_ID": "123", "year_ID": "2026", "WAR": "0"}, {"mlb_ID": "124", "year_ID": "2025", "WAR": "5"}], 2026, "bwar"), {"123": 0})

    def test_traded_player_stints(self):
        rows = [{"mlb_ID": "123", "year_ID": "2026", "stint_ID": "1", "WAR": "1.2"}, {"mlb_ID": "123", "year_ID": "2026", "stint_ID": "2", "WAR": "0.7"}]
        self.assertEqual(normalize(rows, 2026, "bwar"), {"123": 1.9})
        rows.append({"mlb_ID": "123", "year_ID": "2026", "stint_ID": "0", "WAR": "1.9"})
        self.assertEqual(normalize(rows, 2026, "bwar"), {"123": 1.9})

    def test_no_name_matching_or_fangraphs_id_confusion(self):
        with self.assertRaises(ValueError):
            normalize([{"playerid": "123", "Name": "Some Player", "WAR": "4"}], 2026, "fwar")
        self.assertEqual(normalize([{"xMLBAMID": "456", "WAR": "-0.4"}], 2026, "fwar"), {"456": -0.4})

    def test_blocked_sources_keep_snapshot(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder) / "war.js"
            old = PREFIX + '{"seasons":{}};\n'
            path.write_text(old)
            def blocked(url):
                raise PermissionError("403")
            self.assertEqual(update(2026, path, blocked), 0)
            self.assertEqual(path.read_text(), old)

    def test_backfill_reuses_exports_and_preserves_other_seasons(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if "fangraphs" in url:
                from urllib.parse import parse_qs, urlparse
                year = int(parse_qs(urlparse(url).query)["season"][0])
                return json.dumps({"data": [{"xMLBAMID": 123, "Season": year, "WAR": year - 2024}]})
            return "mlb_ID,year_ID,WAR\n123,2025,0\n123,2026,2\n"
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder) / "war.js"
            path.write_text(PREFIX + json.dumps({"seasons": {"2024": {"sources": {"sentinel": 1}}}}) + ";\n")
            self.assertTrue(backfill(2025, 2026, path, fetch))
            self.assertEqual(len(calls), 6)
            saved = json.loads(path.read_text()[len(PREFIX):].strip().removesuffix(";"))
            self.assertEqual(saved["seasons"]["2024"]["sources"]["sentinel"], 1)
            self.assertEqual(saved["seasons"]["2025"]["sources"]["bwarBatting"]["players"]["123"], 0)
            calls.clear()
            self.assertTrue(backfill(2025, 2026, path, fetch))
            self.assertEqual(len(calls), 4)
            self.assertTrue(all("season=2026" in url for url in calls if "fangraphs" in url))

    def test_partial_backfill_is_saved_and_retried(self):
        def fetch(url):
            if "fangraphs" in url:
                return '{"data":[{"xMLBAMID":123,"Season":2025,"WAR":1.5}]}'
            raise PermissionError("403")
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder) / "war.js"
            self.assertFalse(backfill(2025, 2025, path, fetch))
            saved = json.loads(path.read_text()[len(PREFIX):].strip().removesuffix(";"))
            self.assertEqual(saved["seasons"]["2025"]["sources"]["fwarBatting"]["players"]["123"], 1.5)
            with self.assertRaises(ValueError):
                backfill(2026, 2025, path, fetch)


if __name__ == "__main__":
    unittest.main()

