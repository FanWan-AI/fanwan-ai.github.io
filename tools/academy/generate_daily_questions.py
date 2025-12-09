import os
import json
import random
import datetime
import hashlib
import sys

# Add parent directory to sys.path to import ai_llm
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from ai_llm import chat_once

# Load .env manually for local development
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '../../.env')
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

# Updated Data Directory
DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data/ai/games/chinese-legend/')

REALMS = {
    1: {
        "name": "lianqi", 
        "desc": "练气期 (一年级 - 识字与拼音)", 
        "focus": "人教版一年级重点：1. 汉语拼音（声母、韵母、整体认读音节、标调规则）；2. 基础汉字（象形字、会意字、笔画名称、笔顺规则）；3. 简单反义词（大/小，多/少）；4. 基础量词搭配（一头牛，一只猫）。",
        "subtypes": ["pinyin", "character", "logic"]
    },
    2: {
        "name": "zhuji", 
        "desc": "筑基期 (二年级 - 词汇与句式)", 
        "focus": "人教版二年级重点：1. 汉字结构与偏旁部首（形声字规律）；2. 查字典（部首查字法/音序查字法）；3. 多音字辨析；4. 标点符号使用（逗号、句号、问号、感叹号）；5. 仿写句子（比喻句、拟人句初步）。",
        "subtypes": ["character", "logic", "idiom"]
    },
    3: {
        "name": "jiedan", 
        "desc": "结丹期 (三年级 - 段落与修辞)", 
        "focus": "人教版三年级重点：1. 四字成语积累（寓言故事、神话传说）；2. 修辞手法辨析（比喻、拟人、排比）；3. 关联词语应用（因为...所以...，不但...而且...）；4. 古诗理解（唐诗绝句）；5. 关键句（中心句）识别。",
        "subtypes": ["idiom", "poetry", "logic"]
    },
    4: {
        "name": "yuanying", 
        "desc": "元婴期 (四年级 - 篇章与古文)", 
        "focus": "人教版四年级重点：1. 现代诗歌赏析；2. 文言文短篇入门（如《精卫填海》、《王戎不取道旁李》）；3. 复杂句式变换（陈述句转反问句，把字句/被字句）；4. 说明文说明方法（列数字、作比较）；5. 易错字辨析。",
        "subtypes": ["poetry", "history", "logic"]
    },
    5: {
        "name": "huashen", 
        "desc": "化神期 (五年级 - 逻辑与鉴赏)", 
        "focus": "人教版五年级重点：1. 古典名著导读（《西游记》、《三国演义》、《水浒传》、《红楼梦》人物与情节）；2. 汉字字谜与谐音歇后语；3. 说明文与记叙文的区别；4. 深度古诗词赏析（宋词、边塞诗）；5. 修改病句。",
        "subtypes": ["history", "idiom", "logic"]
    },
    6: {
        "name": "dacheng", 
        "desc": "大乘期 (六年级 - 综合与批判)", 
        "focus": "人教版六年级重点：1. 文言文虚词（之、乎、者、也）用法；2. 鲁迅作品及相关文学常识；3. 诗歌意象与情感分析；4. 议论文论点与论据；5. 综合逻辑推理与非连续性文本阅读（图表分析）。",
        "subtypes": ["history", "poetry", "logic"]
    }
}

TARGET_COUNT = 5 # Generate 5 new questions per realm per day

SYSTEM_PROMPT = """
你是一位拥有20年教学经验的中国小学语文特级教师，同时也是一位资深的游戏化教育内容设计师。
你的任务是为《中文传说》这款教育游戏生成高质量、符合人教版（PEP）教材标准的单项选择题。

### 核心要求
1. **教材对标**：严格遵循各年级（境界）的教学大纲和考试重点。
2. **大众化题材**：题目内容应贴近学生日常生活、校园生活、自然常识或经典故事。
   - **避免**：过于生僻的修仙、炼丹、草药等脱离现实的内容。
   - **推荐**：使用“小明在学校...”、“春天来了...”、“《西游记》中...”等大众化语境。
   - *游戏化包装*：可以保留“挑战”、“关卡”等轻度游戏词汇，但不要让修仙设定喧宾夺主。
3. **全中文环境**：所有问题、选项、解释必须完全使用中文（拼音教学题目除外）。严禁出现英文。
4. **一年级拼音标注规则**：
   - 对于一年级（练气期）的题目，如果题干或选项中出现了超出一年级识字范围的生字（如“蝴蝶”、“犹豫”等），**必须**在字后用括号标注拼音。
   - 例如：“请问‘蝴蝶’(hú dié) 喜欢在什么地方飞舞？”
   - 你作为特级教师，请精准判断哪些字需要注音。
5. **错误项设计**：干扰项（错误选项）必须是学生常见的易错点（如形近字、音近字、逻辑陷阱），而不能是一眼假的凑数选项。

### 输出格式
输出必须是纯净的 JSON 数组，不要包含 Markdown 格式标记（如 ```json）。

### 数据结构
[
  {
    "id": "gen_<timestamp>_<random>",
    "type": "choice",
    "subtype": "pinyin" | "character" | "idiom" | "poetry" | "logic" | "history" | "defense",
    "grade": int (1-6),
    "difficulty": int (1-3),
    "tags": ["知识点1", "知识点2"],
    "question": "题目文本（全中文，一年级难字需注音）",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "answer": int (0-3 正确索引),
    "explanation": "解析：解释正确答案的原因，指出错误选项的陷阱。引用相关知识点。"
  }
]

### 题型细则 (Subtype Guide)
- **pinyin**: 拼音辨析。必须使用 Unicode 调号字符 (ā, á, ǎ, à)。
- **character**: 字形、笔画、部首、书写规范。
- **idiom**: 成语填空、释义、近反义词。
- **poetry**: 古诗词默写、赏析、作者背景。
- **logic**: 关联词、病句修改、句式变换、逻辑推理。
- **history**: 文学常识、名著典故、历史传说。
- **defense**: (特殊) 快速反应题，用于游戏防御阶段。重点考察：错别字查找、读音纠错、常识判断。
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
    # Randomly select a subtype to focus on for variety
    target_subtype = random.choice(realm_info.get("subtypes", ["logic"]))
    
    prompt = f"""
    请为【{realm_info['desc']}】生成 {TARGET_COUNT} 道全新的中文学习题目。
    
    ### 当前专注领域
    {realm_info['focus']}
    
    ### 本次生成侧重
    请重点生成类型为 **{target_subtype}** 的题目。
    
    ### 现有题目哈希（避免重复）
    (系统内部已处理去重，请尽情发挥创意)
    
    ### 难度要求
    请混合生成难度 1 (基础), 2 (进阶), 3 (挑战) 的题目。
    
    请直接输出 JSON 数组。
    """
    
    print(f"Generating for {realm_info['desc']} (Focus: {target_subtype})...")
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
