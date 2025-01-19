import cv2
import os

# Paths to the directories
template_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\reagentTemplates2"
#target_image_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk\Scan2025-01-12_233307_Card_6.jpg"
target_image_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk\Scan2025-01-12_233307_Card_2.jpg"
#target_image_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk\Scan2025-01-12_233548_Card_1.jpg"
#target_image_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk\Scan2025-01-12_233828_Card_1.jpg"
target_image_path = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk\Scan2025-01-12_234334_Card_5.jpg"

# Load the template and target image
#template_name = "Eye of Newt.jpg"  # Example template name
template_name = "Mandrake.png"  # Example template name
template_path = os.path.join(template_dir, template_name)

# Read images in grayscale
template = cv2.imread(template_path, cv2.IMREAD_GRAYSCALE)
target_image = cv2.imread(target_image_path, cv2.IMREAD_GRAYSCALE)

if template is None or target_image is None:
    print("Error: Could not load the template or target image.")
    exit()

# Define a confidence threshold
CONFIDENCE_THRESHOLD = 0.3  # Adjust this value as needed

# Clone the target image for modification
target_image_clone = target_image.copy()
match_count = 0

while True:
    # Perform template matching
    result = cv2.matchTemplate(target_image_clone, template, cv2.TM_CCOEFF_NORMED)

    # Find the best match location
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

    # Check if the match meets the confidence threshold
    if max_val < CONFIDENCE_THRESHOLD:
        print(f"No more matches found above the threshold ({CONFIDENCE_THRESHOLD}). Stopping.")
        break

    match_count += 1

    # Get the top-left corner of the matching area
    top_left = max_loc
    # Get the bottom-right corner based on the template size
    h, w = template.shape
    bottom_right = (top_left[0] + w, top_left[1] + h)

    # Calculate the center coordinates of the match
    center_x = top_left[0] + w // 2
    center_y = top_left[1] + h // 2

    # Print match information
    print(f"Match {match_count}: Confidence={max_val:.2f}, Center=(x={center_x}, y={center_y})")

    # Draw a bounding box and center dot on the match
    target_image_color = cv2.cvtColor(target_image_clone, cv2.COLOR_GRAY2BGR)  # Convert grayscale to BGR for visualization
    cv2.rectangle(target_image_color, top_left, bottom_right, (0, 255, 0), 2)
    cv2.circle(target_image_color, (center_x, center_y), radius=5, color=(0, 0, 255), thickness=-1)

    # Display the result after each match
    cv2.imshow(f"Match {match_count}", target_image_color)
    cv2.waitKey(0)

    # Black out the matched area in the target image clone
    cv2.rectangle(target_image_clone, top_left, bottom_right, 0, -1)

    # Display the modified image after blacking out
    cv2.imshow(f"Modified Image After Match {match_count}", target_image_clone)
    cv2.waitKey(0)

cv2.destroyAllWindows()
print(f"Total matches found: {match_count}")
