# -*- coding: utf-8 -*-
import json
import os
import sys
import random

# Add the current directory to sys.path to import ai_llm
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load .env file manually
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()

try:
    from ai_llm import chat_once
except ImportError:
    print("Error: Could not import ai_llm. Make sure ai_llm.py is in the same directory.")
    sys.exit(1)

QUESTIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'data', 'chinese-legend', 'questions_v3.json')

SYSTEM_PROMPT = """
You are an expert Chinese language teacher and game content creator. 
Your task is to generate multiple-choice questions for a Chinese learning game.
The output must be a valid JSON array of objects.
Do not include any markdown formatting (like ```json). Just the raw JSON array.

Each question object must have the following fields:
- "id": A unique string ID (e.g., "gen_123").
- "type": Always "choice".
- "subtype": One of ["pinyin", "idiom", "poetry", "logic", "defense"].
- "grade": Integer 1-6 (difficulty level).
- "difficulty": Integer 1-3.
- "tags": Array of strings describing the content.
- "question": The question text. IMPORTANT: Do NOT include the answer or the pinyin of the answer in the question text itself.
- "options": Array of 4 strings (the choices).
- "answer": Integer 0-3 (index of the correct option).
- "explanation": A brief explanation of the answer.

Special Instructions:
1. **No Spoilers**: Never put the answer in the question. 
   - BAD: "下列哪个字的读音是 'chuí' (垂)？" (Reveals '垂')
   - GOOD: "下列哪个字的读音是 'chuí'？"
2. **Defense Questions**:
   - These are for quick reaction.
   - Focus on: Spotting typos (错别字), Tone errors (变调错误), Logic errors (语病).
   - Example: "下列哪个词语书写正确？"
3. **Variety**: Generate questions for different grades (1-6).
4. **Creativity**: Use interesting contexts. For idioms, use stories. For poetry, use famous lines but vary the missing part.
"""

def load_existing_questions():
    if not os.path.exists(QUESTIONS_FILE):
        return []
    try:
        with open(QUESTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading existing questions: {e}")
        return []

def save_questions(questions):
    try:
        with open(QUESTIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(questions, f, ensure_ascii=False, indent=4)
        print(f"Successfully saved {len(questions)} questions to {QUESTIONS_FILE}")
    except Exception as e:
        print(f"Error saving questions: {e}")

def generate_questions(count=5, subtype=None, grade=None):
    prompt = f"Generate {count} unique Chinese learning questions."
    if subtype:
        prompt += f" Focus on the '{subtype}' subtype."
    if grade:
        prompt += f" Target Grade {grade} students."
    
    prompt += " Ensure the questions are suitable for primary school students but challenging enough for a game."

    print(f"Requesting {count} questions from AI... (Subtype: {subtype}, Grade: {grade})")
    
    try:
        response = chat_once(prompt, system=SYSTEM_PROMPT)
        # Clean up response if it contains markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0].strip()
        elif "```" in response:
            response = response.split("```")[1].split("```")[0].strip()
            
        new_questions = json.loads(response)
        
        # Post-process IDs to ensure uniqueness
        existing_ids = {q['id'] for q in load_existing_questions()}
        for q in new_questions:
            # Ensure answer is int
            if isinstance(q.get('answer'), str):
                try:
                    q['answer'] = int(q['answer'])
                except:
                    pass # Should be handled by validation or fail later
            
            while q['id'] in existing_ids or not q['id'].startswith('gen_'):
                q['id'] = f"gen_{random.randint(10000, 99999)}"
            existing_ids.add(q['id'])
            
        return new_questions
    except json.JSONDecodeError:
        print("Error: AI response was not valid JSON.")
        print("Response:", response)
        return []
    except Exception as e:
        print(f"Error generating questions: {e}")
        return []

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate questions for Chinese Legend game.")
    parser.add_argument("--count", type=int, default=5, help="Number of questions to generate")
    parser.add_argument("--subtype", type=str, choices=["pinyin", "idiom", "poetry", "logic", "defense"], help="Specific subtype to generate")
    parser.add_argument("--grade", type=int, choices=[1, 2, 3, 4, 5, 6], help="Specific grade to generate for")
    
    args = parser.parse_args()
    
    existing = load_existing_questions()
    new_qs = generate_questions(args.count, args.subtype, args.grade)
    
    if new_qs:
        # Filter out duplicates based on question text to avoid "bad" questions piling up
        existing_texts = {q['question'] for q in existing}
        unique_new_qs = [q for q in new_qs if q['question'] not in existing_texts]
        
        combined = existing + unique_new_qs
        save_questions(combined)
        print(f"Added {len(unique_new_qs)} new unique questions.")
    else:
        print("No questions added.")
