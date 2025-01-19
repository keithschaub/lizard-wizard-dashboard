import os
import json
from PIL import Image
import pytesseract

# Set Tesseract path
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Paths
IMAGE_MAIN_DIR = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\spells"  # Directory with card images
JSON_FILE = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\spell_cards.json"  # JSON file with spell cards
OUTPUT_JSON = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\spell_cards_updated.json"  # Updated JSON file

# Load JSON data
with open(JSON_FILE, "r") as f:
    card_data = json.load(f)

# Group JSON cards by school
cards_by_school = {}
for card in card_data:
    school = card["school"].lower()  # Normalize school name for directory matching
    if school not in cards_by_school:
        cards_by_school[school] = []
    cards_by_school[school].append(card)

# Function to extract text from an image
def extract_text(image_path):
    try:
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img).strip()
        print(f"Extracted text from '{image_path}':\n{text}\n")  # Debugging output
        return text
    except Exception as e:
        print(f"Error reading {image_path}: {e}")
        return None

# Map images to JSON entries
for school, cards in cards_by_school.items():
    school_dir = os.path.join(IMAGE_MAIN_DIR, school)
    if not os.path.exists(school_dir):
        print(f"Directory does not exist for school '{school}': {school_dir}")
        continue

    # List all image files in the school directory
    image_files = sorted(
        [f for f in os.listdir(school_dir) if f.endswith(".png")]
    )

    if not image_files:
        print(f"No image files found for school '{school}' in directory '{school_dir}'")
        continue

    # Match images to JSON entries by order
    for i, card in enumerate(cards):
        if i < len(image_files):
            image_path = os.path.join(school_dir, image_files[i])
            extracted_text = extract_text(image_path)  # Debugging: Extract text

            if extracted_text:
                print(f"✔ Mapped extracted text to JSON card '{card['name']}'")
                card["imagePath"] = image_path
            else:
                print(f"✘ Failed to map extracted text to card '{card['name']}' in school '{school}'")
        else:
            print(f"✘ No image available for card '{card['name']}' in school '{school}'")

# Save updated JSON
with open(OUTPUT_JSON, "w") as f:
    json.dump(card_data, f, indent=4)

print(f"Updated JSON saved to {OUTPUT_JSON}")
