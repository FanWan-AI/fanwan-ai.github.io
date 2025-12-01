import json
import os
from pathlib import Path

# Paths
REPO_ROOT = Path(os.getcwd())
TOPICS_PATH = REPO_ROOT / "data" / "ai" / "daily-academy" / "topics.json"
DAILY_PATH = REPO_ROOT / "data" / "ai" / "daily-academy" / "daily.json"
AUDIO_DIR = REPO_ROOT / "assets" / "audio" / "daily"

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def flatten_topics(topics_data):
    flat_topics = []
    for level in topics_data:
        for category in level.get('categories', []):
            for topic in category.get('topics', []):
                flat_topics.append(topic['topic'])
    return flat_topics

def process_lesson(lesson):
    lesson_id = lesson['id']
    audio_filename = f"{lesson_id}-zh.mp3"
    audio_path = AUDIO_DIR / audio_filename
    
    if audio_path.exists():
        if 'audio' not in lesson:
            lesson['audio'] = {}
        lesson['audio']['zh'] = f"/assets/audio/daily/{audio_filename}"
    else:
        if 'audio' in lesson:
            del lesson['audio']
    return lesson

def main():
    print("Loading data...")
    topics_data = load_json(TOPICS_PATH)
    daily_data = load_json(DAILY_PATH)
    
    ordered_titles = flatten_topics(topics_data)
    print(f"Found {len(ordered_titles)} topics in topics.json")
    
    # Map existing lessons by title (zh)
    lesson_map = {}
    for lesson in daily_data['lessons']:
        title_zh = lesson['title']['zh']
        lesson_map[title_zh] = lesson
    
    print(f"Found {len(lesson_map)} unique lessons in daily.json")
    
    new_lessons = []
    
    # Reorder based on topics.json
    for title in ordered_titles:
        if title in lesson_map:
            lesson = lesson_map[title]
            lesson = process_lesson(lesson)
            new_lessons.append(lesson)
            del lesson_map[title]
            
    # Handle remaining lessons (not in topics.json)
    if lesson_map:
        print(f"Warning: {len(lesson_map)} lessons in daily.json are not in topics.json:")
        for title in lesson_map:
            print(f"  - {title}")
        for lesson in lesson_map.values():
            lesson = process_lesson(lesson)
            new_lessons.append(lesson)

    daily_data['lessons'] = new_lessons
    
    print(f"Saving {len(new_lessons)} lessons to daily.json")
    save_json(DAILY_PATH, daily_data)
    print("Done.")

if __name__ == "__main__":
    main()
