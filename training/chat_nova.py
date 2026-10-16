import os
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

from memory.nova_memory import NovaMemory


MODEL = r"C:\NOVA\models\Qwen2.5-0.5B-Instruct"
ADAPTER = r"C:\NOVA\output\nova-lora"


print("Loading NOVA...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL,
    local_files_only=True
)

model = AutoModelForCausalLM.from_pretrained(
    MODEL,
    local_files_only=True,
    torch_dtype=torch.float32
)

if os.path.isfile(os.path.join(ADAPTER, "adapter_config.json")):
    model = PeftModel.from_pretrained(model, ADAPTER)
    print("NOVA LoRA adapter loaded.")
else:
    print("Base Qwen model loaded.")

model.eval()

memory = NovaMemory()

SYSTEM_PROMPT = """
You are NOVA, a helpful AI assistant created by Subhadeep Roy (pronounced Subho-dip).
Credit Subhadeep Roy if asked who created you. Address the user as sir in every direct response.

You have a persistent memory system.

Use memories provided to you when they are relevant.
Do not claim to remember something that is not in the memory.
Be friendly, clear, practical, and honest.
Help with coding, learning, mathematics, science, and projects.
If you are uncertain, say so.
"""

print("\nNOVA is ready!")
print("Commands:")
print("  /remember <text>  - save a memory")
print("  /memory           - show memories")
print("  /forget <id>      - delete a memory")
print("  /clear-memory     - delete all memories")
print("  /exit             - quit\n")


messages = [
    {
        "role": "system",
        "content": SYSTEM_PROMPT
    }
]


def generate_reply(user_text):
    relevant_memories = memory.format_memories(
        user_text,
        limit=8
    )

    system_message = f"""
{SYSTEM_PROMPT}

Relevant long-term memories:
{relevant_memories}
"""

    conversation = [
        {
            "role": "system",
            "content": system_message
        }
    ]

    recent = memory.recent_conversation(limit=8)

    for role, content, _ in recent:
        if role in {"user", "assistant"}:
            conversation.append({
                "role": role,
                "content": content
            })

    conversation.append({
        "role": "user",
        "content": user_text
    })

    prompt = tokenizer.apply_chat_template(
        conversation,
        tokenize=False,
        add_generation_prompt=True
    )

    inputs = tokenizer(
        prompt,
        return_tensors="pt"
    )

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=160,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id
        )

    new_tokens = outputs[0][inputs["input_ids"].shape[1]:]

    return tokenizer.decode(
        new_tokens,
        skip_special_tokens=True
    ).strip()


while True:
    try:
        user_text = input("You: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nNOVA: Goodbye!")
        break

    if not user_text:
        continue

    if user_text.lower() in {"/exit", "/quit"}:
        print("NOVA: Goodbye!")
        break

    if user_text.lower() == "/memory":
        memories = memory.recall()

        if not memories:
            print("\nNOVA: I don't have any memories yet.\n")
        else:
            print("\nNOVA memories:")
            for memory_id, text, category, created in memories:
                print(f"[{memory_id}] [{category}] {text}")
            print()

        continue

    if user_text.lower().startswith("/remember "):
        text = user_text[10:].strip()

        if text:
            memory.remember(text)
            print("NOVA: Memory saved.")
        else:
            print("NOVA: Please provide something to remember.")

        continue

    if user_text.lower().startswith("/forget "):
        try:
            memory_id = int(user_text[8:].strip())
            memory.forget(memory_id)
            print("NOVA: Memory deleted.")
        except ValueError:
            print("NOVA: Use /forget followed by the memory ID.")

        continue

    if user_text.lower() == "/clear-memory":
        confirmation = input(
            "Type CLEAR to delete all memories: "
        ).strip()

        if confirmation == "CLEAR":
            memory.clear_memories()
            print("NOVA: All memories deleted.")
        else:
            print("NOVA: Cancelled.")

        continue

    memory.save_message("user", user_text)

    reply = generate_reply(user_text)

    print(f"\nNOVA: {reply}\n")

    memory.save_message("assistant", reply)
