import tempfile
import unittest
from pathlib import Path
from update_war import normalize, update, PREFIX


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
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "war.js"
            old = PREFIX + '{"seasons":{}};\n'
            path.write_text(old)
            def blocked(url):
                raise PermissionError("403")
            self.assertEqual(update(2026, path, blocked), 0)
            self.assertEqual(path.read_text(), old)


if __name__ == "__main__":
    unittest.main()

