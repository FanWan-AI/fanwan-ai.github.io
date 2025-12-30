# -*- coding: utf-8 -*-
"""Merge AI Radar daily briefing audio files.

This script merges the morning and evening briefing audio segments into a single sequence.
It relies on `generate_briefing.py` having created a backup of the morning briefing
(e.g., `YYYY-MM-DD.morning.json`).

Logic:
1. Load Morning Briefing and Evening Briefing.
2. Keep Morning Intro + Content.
3. Keep Evening Content + Outro.
4. Combine and save to the daily briefing file.

Usage:
    python tools/ai_radar/merge_audio.py [YYYY-MM-DD]
"""
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Directories
_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parent.parent
DATA_DIR = ROOT / "data" / "ai" / "airadar"
BRIEFINGS_DIR = DATA_DIR / "briefings"


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[merge_audio] Failed to load {path}: {e}")
        return None


def merge_briefings(date_str: str):
    morning_path = BRIEFINGS_DIR / f"{date_str}.morning.json"
    evening_path = BRIEFINGS_DIR / f"{date_str}.json"
    
    if not morning_path.exists():
        print(f"[merge_audio] No morning backup found for {date_str} ({morning_path.name}). Skipping merge.")
        return
    
    if not evening_path.exists():
        print(f"[merge_audio] No evening briefing found for {date_str}. Skipping merge.")
        return

    print(f"[merge_audio] Merging briefings for {date_str}...")
    morning = _load_json(morning_path)
    evening = _load_json(evening_path)
    
    if not morning or not evening:
        return
    
    m_audio = morning.get("audio", {}).get("segments", [])
    e_audio = evening.get("audio", {}).get("segments", [])
    
    if not m_audio:
        print("[merge_audio] Morning briefing has no audio segments.")
        return
    if not e_audio:
        print("[merge_audio] Evening briefing has no audio segments.")
        return

    # Heuristic for splitting:
    # Morning: Keep everything EXCEPT the last 2 segments (Closing + CTA)
    # Evening: Keep everything EXCEPT the first 1 segment (Opening)
    
    m_cut_index = -2
    e_start_index = 1
    
    # Safety checks
    if len(m_audio) <= abs(m_cut_index):
        print(f"[merge_audio] Morning audio has only {len(m_audio)} segments. Keeping all.")
        m_final = m_audio
    else:
        m_final = m_audio[:m_cut_index]
        
    if len(e_audio) <= e_start_index:
        print(f"[merge_audio] Evening audio has only {len(e_audio)} segments. Keeping all.")
        e_final = e_audio
    else:
        e_final = e_audio[e_start_index:]
        
    merged_segments = m_final + e_final
    
    print(f"[merge_audio] Merged: {len(m_final)} morning segments + {len(e_final)} evening segments = {len(merged_segments)} total.")
    
    # Update Evening JSON
    if "audio" not in evening:
        evening["audio"] = {}
    evening["audio"]["segments"] = merged_segments
    
    # Update script paragraphs to match audio
    m_paras = morning.get("script", {}).get("paragraphs", [])
    e_paras = evening.get("script", {}).get("paragraphs", [])
    
    if m_paras and e_paras:
        if len(m_paras) > abs(m_cut_index) and len(e_paras) > e_start_index:
            merged_paras = m_paras[:m_cut_index] + e_paras[e_start_index:]
            if "script" not in evening:
                evening["script"] = {}
            evening["script"]["paragraphs"] = merged_paras
            evening["script_text"] = "\n\n".join(merged_paras)
            print(f"[merge_audio] Updated script paragraphs as well.")
    
    # Save
    evening_path.write_text(json.dumps(evening, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[merge_audio] Successfully saved merged briefing to {evening_path.name}")


def main():
    if len(sys.argv) > 1:
        date_str = sys.argv[1]
    else:
        # Default to today's date based on latest briefing
        briefing_files = sorted(BRIEFINGS_DIR.glob("*.json"))
        # Filter out .morning.json
        briefing_files = [f for f in briefing_files if not f.name.endswith(".morning.json")]
        
        if not briefing_files:
            print("[merge_audio] No briefing files found.")
            return
        
        latest_briefing_path = briefing_files[-1]
        date_str = latest_briefing_path.stem
    
    merge_briefings(date_str)


if __name__ == "__main__":
    main()
