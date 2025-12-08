import os
import json
import random
import datetime
import hashlib
from ai_llm import chat_once

# Load .env manually for local development
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '../.env')
    if os.path.exists(env_path):
        print(f"Loading environment from {env_path}")
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    if not os.environ.get(key):
                        os.environ[key] = value

load_env()

DATA_DIR = os.path.join(os.path.dirname(__file__), '../assets/data/chinese-legend/')

REALMS = {
    1: {"name": "lianqi", "desc": "练气期 (Grade 1)", "focus": "拼音（声母/韵母/声调），基本笔画（一/丨/丿/乀），简单象形字（日/月/水/火）。"},
    2: {"name": "zhuji", "desc": "筑基期 (Grade 2)", "focus": "偏旁部首，汉字结构（左右/上下），简单反义词。"},
    3: {"name": "jiedan", "desc": "结丹期 (Grade 3)", "focus": "基础成语，近义词/反义词，多音字。"},
    4: {"name": "yuanying", "desc": "元婴期 (Grade 4)", "focus": "进阶成语，句子排序，标点符号，基础古诗。"},
    5: {"name": "huashen", "desc": "化神期 (Grade 5)", "focus": "唐诗宋词，修辞手法（比喻/拟人），古代故事。"},
    6: {"name": "dacheng", "desc": "大乘期 (Grade 6)", "focus": "文言文虚词，历史典故，四大名著，复杂逻辑推理。"}
}

TARGET_COUNT = 5 # Generate 5 new questions per realm per day

SYSTEM_PROMPT = """
你是一个《中文传说》教育游戏的专家级内容生成器。
你的任务是生成高质量、适合年龄的中文多项选择题。
输出必须是有效的 JSON 数组。严禁使用 Markdown 格式。
所有问题、选项和解释必须完全使用中文（除了拼音教学中必须的拼音字母）。

每个问题的结构：
{
    "id": "unique_id_string",
    "type": "choice",
    "subtype": "pinyin" | "character" | "idiom" | "poetry" | "logic" | "history",
    "grade": int (1-6),
    "difficulty": int (1-3),
    "tags": ["tag1", "tag2"],
    "question": "问题文本（必须是中文）",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "answer": int (0-3 正确选项的索引),
    "explanation": "简短的中文解释"
}

关键规则：
1. **语言**：问题、选项（除非是拼音题）、解释必须全部使用中文。严禁出现英文问题。
2. **拼音**：使用预组合的 Unicode 字符表示声调（例如：'ā', 'é', 'ǐ', 'ò'）。不要使用组合变音符号。
   - 例如："māma" 必须使用 'ā' (U+0101)。
3. **唯一性**：确保问题独特且有创意。
4. **输出**：仅输出 JSON 数组。
"""

def get_file_path(grade, realm_name):
    return os.path.join(DATA_DIR, f"questions_grade_{grade}_{realm_name}.json")

def load_existing_hashes():
    hashes = set()
    for grade, info in REALMS.items():
        path = get_file_path(grade, info['name'])
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for q in data:
                        # Hash the question text to ensure semantic uniqueness
                        q_hash = hashlib.md5(q['question'].strip().encode('utf-8')).hexdigest()
                        hashes.add(q_hash)
            except Exception as e:
                print(f"Error reading {path}: {e}")
    return hashes

def generate_for_realm(grade, realm_info, existing_hashes):
    prompt = f"""
    为 {realm_info['desc']} 生成 {TARGET_COUNT} 个独特的中文学习问题。
    重点领域：{realm_info['focus']}
    确保 JSON 格式有效。
    """
    
    print(f"Generating for {realm_info['desc']}...")
    try:
        response = chat_once(prompt, system=SYSTEM_PROMPT)
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
            
        data = json.loads(response)
        
        valid_questions = []
        for q in data:
            q_hash = hashlib.md5(q['question'].strip().encode('utf-8')).hexdigest()
            if q_hash not in existing_hashes:
                q['id'] = f"daily_{grade}_{datetime.datetime.now().strftime('%Y%m%d')}_{random.randint(10000,99999)}"
                q['grade'] = grade # Enforce grade
                valid_questions.append(q)
                existing_hashes.add(q_hash)
            else:
                print(f"Duplicate question skipped: {q['question'][:20]}...")
                
        return valid_questions
    except Exception as e:
        print(f"Error generating batch for Grade {grade}: {e}")
        return []

def main():
    print(f"Starting Daily Content Generation: {datetime.datetime.now()}")
    
    existing_hashes = load_existing_hashes()
    print(f"Loaded {len(existing_hashes)} existing question hashes.")
    
    for grade, info in REALMS.items():
        new_qs = generate_for_realm(grade, info, existing_hashes)
        
        if new_qs:
            path = get_file_path(grade, info['name'])
            existing_data = []
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
            
            existing_data.extend(new_qs)
            
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(existing_data, f, ensure_ascii=False, indent=4)
            print(f"Added {len(new_qs)} questions to {info['name']}.")
        else:
            print(f"No new questions for {info['name']}.")

if __name__ == "__main__":
    main()
