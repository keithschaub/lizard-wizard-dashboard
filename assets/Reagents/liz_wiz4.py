import cv2
import numpy as np
import os

# Define input and output directories
input_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\raw_input_scans"
output_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\output"

# Ensure the output directory exists
os.makedirs(output_dir, exist_ok=True)

# Define the gray color range
low_grey = np.array([0, 0, 50])
high_grey = np.array([180, 50, 200])


# Function to check if a contour is far enough from previous contours
def is_far_enough(new_contour, previous_contours, min_distance):
    x_new, y_new, w_new, h_new = cv2.boundingRect(new_contour)
    center_new = (x_new + w_new // 2, y_new + h_new // 2)
    for prev_contour in previous_contours:
        x_prev, y_prev, w_prev, h_prev = cv2.boundingRect(prev_contour)
        center_prev = (x_prev + w_prev // 2, y_prev + h_prev // 2)
        distance = np.sqrt((center_new[0] - center_prev[0]) ** 2 + (center_new[1] - center_prev[1]) ** 2)
        if distance < min_distance:
            return False
    return True


# Function to check if a contour size matches the expected dimensions
def is_similar_size(new_contour, nominal_width=760, nominal_height=1060, tolerance=0.2):
    x, y, w, h = cv2.boundingRect(new_contour)
    width_match = abs(w - nominal_width) <= nominal_width * tolerance
    height_match = abs(h - nominal_height) <= nominal_height * tolerance
    return width_match and height_match


# Process each image in the input directory
for filename in os.listdir(input_dir):
    if filename.lower().endswith(('.jpg', '.png')):
        # Load the image
        image_path = os.path.join(input_dir, filename)
        image = cv2.imread(image_path)

        # Convert the image to HSV
        image_hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

        # Create a mask for the gray area
        grey_mask = cv2.inRange(image_hsv, low_grey, high_grey)

        # Find contours
        contours, _ = cv2.findContours(grey_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

        # Sort contours by area (biggest to smallest)
        contours = sorted(contours, key=lambda x: cv2.contourArea(x), reverse=True)

        # Process only the first 4 valid contours and save each valid card
        previous_contours = []
        card_count = 0
        for cnt in contours:
            if (is_similar_size(cnt, nominal_width=760, nominal_height=1060, tolerance=0.2) and
                    is_far_enough(cnt, previous_contours, min_distance=100)):
                (x, y, w, h) = cv2.boundingRect(cnt)

                # Print contour details
                center = (x + w // 2, y + h // 2)
                print(
                    f"Contour {card_count + 1}: Center={center}, Width={w}, Height={h}, Corners=[({x}, {y}), ({x + w}, {y}), ({x}, {y + h}), ({x + w}, {y + h})]")

                # Annotate the image with contour details
                annotated_image = image.copy()
                cv2.rectangle(annotated_image, (x, y), (x + w, y + h), (0, 255, 0), 20)
                text1 = f"Ctr {card_count + 1}: Ctr={center}"
                text2 = f"W={w}, H={h}"
                corners_text = f"Corners=[({x}, {y}), ({x + w}, {y}), ({x}, {y + h}), ({x + w}, {y + h})]"

                # Write details on the annotated image
                cv2.putText(annotated_image, text1, (x, y - 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                cv2.putText(annotated_image, text2, (x, y - 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                cv2.putText(annotated_image, corners_text, (x, y + h + 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 0, 0),
                            2)

                # Save the annotated image
                annotated_output_path = os.path.join(output_dir,
                                                     f"{os.path.splitext(filename)[0]}_Annotated_{card_count + 1}.jpg")
                #cv2.imwrite(annotated_output_path, annotated_image)

                # Save the cropped card
                cropped_card = image[y:y + h, x:x + w]
                output_path = os.path.join(output_dir, f"{os.path.splitext(filename)[0]}_Card_{card_count + 1}.jpg")
                cv2.imwrite(output_path, cropped_card)
                print(f"Saved: {output_path}")

                # Add the current contour to the list of previous contours
                previous_contours.append(cnt)
                card_count += 1

                # Stop after processing 4 valid contours
                if card_count == 6:
                    break
