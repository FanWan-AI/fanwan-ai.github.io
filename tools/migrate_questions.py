import json
import os

SOURCE_FILE = 'assets/data/chinese-legend/questions_v3.json'
OUTPUT_DIR = 'assets/data/chinese-legend/'

REALMS = {
    1: "lianqi",   # 练气
    2: "zhuji",    # 筑基
    3: "jiedan",   # 结丹
    4: "yuanying", # 元婴
    5: "huashen",  # 化神
    6: "dacheng"   # 大乘
}

def migrate():
    if not os.path.exists(SOURCE_FILE):
        print(f"Source file {SOURCE_FILE} not found.")
        return

    with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    questions_by_grade = {g: [] for g in range(1, 7)}

    for q in data:
        grade = q.get('grade', 1)
        if grade < 1: grade = 1
        if grade > 6: grade = 6
        questions_by_grade[grade].append(q)

    for grade, questions in questions_by_grade.items():
        realm_name = REALMS[grade]
        filename = f"questions_grade_{grade}_{realm_name}.json"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(questions, f, ensure_ascii=False, indent=4)
        
        print(f"Saved {len(questions)} questions to {filename}")

if __name__ == "__main__":
    migrate()
