
import json
from pathlib import Path

import torch
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    Trainer,
    TrainingArguments,
    default_data_collator,
)
from peft import LoraConfig, get_peft_model, TaskType

BASE_DIR = Path(__file__).resolve().parent.parent
BASE = BASE_DIR / "models" / "Qwen2.5-0.5B-Instruct"
TRAIN_FILE = BASE_DIR / "dataset" / "train.jsonl"
OUTPUT = BASE_DIR / "output" / "nova-lora"
MAX_LENGTH = 256


def load_examples(path, tokenizer):
    examples = []

    with open(path, "r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue

            item = json.loads(line)
            messages = item["messages"]
            if not messages or messages[-1]["role"] != "assistant":
                raise ValueError(
                    "Each training example must end with an assistant message."
                )

            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )

            encoded = tokenizer(
                text,
                truncation=True,
                max_length=MAX_LENGTH,
                padding="max_length",
            )

            ids = encoded["input_ids"]
            mask = encoded["attention_mask"]
            prompt = tokenizer.apply_chat_template(
                messages[:-1],
                tokenize=True,
                add_generation_prompt=True,
            )
            if hasattr(prompt, "keys"):
                prompt = prompt["input_ids"]
            if hasattr(prompt, "tolist"):
                prompt = prompt.tolist()
            if prompt and isinstance(prompt[0], list):
                prompt = prompt[0]
            prompt_length = len(prompt)
            if ids[:prompt_length] != prompt:
                raise ValueError(
                    "Could not identify the assistant response boundary in "
                    "a training example."
                )

            labels = [
                token if token_mask and index >= prompt_length else -100
                for index, (token, token_mask) in enumerate(zip(ids, mask))
            ]

            examples.append({
                "input_ids": ids,
                "attention_mask": mask,
                "labels": labels,
            })

    return examples

def main():
    if not TRAIN_FILE.is_file():
        raise FileNotFoundError(
            f"Training dataset not found: {TRAIN_FILE}"
        )

    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(
        BASE, local_files_only=True
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("Loading model on CPU...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE,
        local_files_only=True,
        torch_dtype=torch.float32,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False

    print("Preparing LoRA...")
    lora = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=4,
        lora_alpha=8,
        lora_dropout=0.05,
        target_modules=["q_proj", "v_proj"],
        bias="none",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    print("Reading training examples...")
    train_data = load_examples(TRAIN_FILE, tokenizer)

    if not train_data:
        raise ValueError("Training dataset is empty.")

    args = TrainingArguments(
        output_dir=str(OUTPUT),
        num_train_epochs=3,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=1,
        learning_rate=1e-4,
        logging_steps=1,
        save_strategy="epoch",
        save_total_limit=1,
        report_to="none",
        use_cpu=True,
        dataloader_num_workers=0,
        optim="adamw_torch",
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_data,
        data_collator=default_data_collator,
    )

    print("Starting NOVA LoRA training...")
    trainer.train()

    print("Saving NOVA adapter...")
    trainer.save_model(OUTPUT)
    tokenizer.save_pretrained(OUTPUT)
    print(f"Training complete. Adapter saved to: {OUTPUT}")

if __name__ == "__main__":
    main()
