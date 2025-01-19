from inference_sdk import InferenceHTTPClient
import cv2
import os
import json

# Flag to toggle displaying results on the screen
DISPLAY_RESULTS = False

# Create an inference client
CLIENT = InferenceHTTPClient(
    api_url="https://detect.roboflow.com",
    api_key="9rbhoPcyNgvDE8oxz9L2"
)

# Directory containing all the cards
cards_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\output"
output_images_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\outputRoboflow"
output_json_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\output.json"

# Ensure the output directory exists
os.makedirs(output_images_dir, exist_ok=True)

# Get a list of all image files in the directory
card_files = [os.path.join(cards_dir, f) for f in os.listdir(cards_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]

# Initialize results dictionary
results = {"cards": []}

# Process each card in the directory
for card_path in card_files:
    print(f"Processing card: {card_path}")
    card_name = os.path.basename(card_path)

    # Run inference on the current card
    response = CLIENT.infer(
        card_path,
        model_id="lw2/8"
    )

    # Load the card image to draw bounding boxes
    image = cv2.imread(card_path)
    if image is None:
        print(f"Error: Could not load the image at {card_path}. Skipping.")
        continue

    # Initialize lists for categorizing predictions
    gather_reagents = []
    increase_value = []

    # Parse the predictions and draw bounding boxes
    predictions = response.get("predictions", [])
    for prediction in predictions:
        # Extract bounding box information
        x, y = int(prediction["x"]), int(prediction["y"])
        width, height = int(prediction["width"]), int(prediction["height"])
        class_name = prediction["class"]

        # Categorize based on the y-coordinate
        if y < 500:
            gather_reagents.append(class_name)
        else:
            increase_value.append(class_name)

        # Calculate top-left and bottom-right corners
        top_left = (x - width // 2, y - height // 2)
        bottom_right = (x + width // 2, y + height // 2)

        # Draw the bounding box
        cv2.rectangle(image, top_left, bottom_right, (0, 255, 0), 2)

        # Add label with class name
        label = f"{class_name}"
        label_position = (top_left[0], top_left[1] - 10)
        cv2.putText(image, label, label_position, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

    # Add the results for the card to the JSON structure
    results["cards"].append({
        "card_name": card_name,
        "gather_reagents": gather_reagents,
        "increase_value": increase_value
    })

    # Save the annotated image to the output directory
    annotated_image_path = os.path.join(output_images_dir, card_name)
    cv2.imwrite(annotated_image_path, image)
    print(f"Annotated image saved to {annotated_image_path}")

    # Display the image with bounding boxes if DISPLAY_RESULTS is True
    if DISPLAY_RESULTS:
        cv2.imshow(f"Detected Objects in {card_name}", image)
        print(f"Press any key to proceed to the next card.")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

# Write the JSON results to a file
with open(output_json_path, "w") as json_file:
    json.dump(results, json_file, indent=4)
print(f"Results written to {output_json_path}")

print("Finished processing all cards.")
