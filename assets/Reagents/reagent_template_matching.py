import cv2
import os
import numpy as np
from sklearn.cluster import DBSCAN

# Directories
template_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\reagentTemplates"
card_dir = r"C:\Users\Keith.Schaub\OneDrive\pythonProject\LizardWizard\assets\Reagents\junk"

# Initialize SIFT detector
sift = cv2.SIFT_create()

# Initialize FLANN-based matcher
flann_index_kdtree = 1
index_params = dict(algorithm=flann_index_kdtree, trees=5)
search_params = dict(checks=50)  # Higher checks for better accuracy
flann = cv2.FlannBasedMatcher(index_params, search_params)

# Precompute keypoints, descriptors, and dimensions for templates
template_features = {}
template_dimensions = {}

for template_file in os.listdir(template_dir):
    if template_file.endswith('.jpg'):
        template_path = os.path.join(template_dir, template_file)
        template_image = cv2.imread(template_path, 0)  # Load in grayscale

        # Detect and compute keypoints and descriptors
        keypoints, descriptors = sift.detectAndCompute(template_image, None)
        template_features[template_file] = (keypoints, descriptors)

        # Store template dimensions
        template_dimensions[template_file] = template_image.shape  # (height, width)

# Distance thresholds for specific templates
distance_thresholds = {
    "Eye of Newt.jpg": 0.6,
    "Nightshade.jpg": 0.55,
    "Foxglove.jpg": 0.35,
    "Mandrake.jpg": 0.50,
    "Toadstool.jpg": 0.30,
    "Sulfur.jpg": 0.35,
    "Horn.jpg": 0.5
}
default_threshold = 0.4  # Default for all other templates

# Function to cluster matches and retain one match per cluster
def cluster_matches(matches, keypoints, eps=50, min_samples=2):
    if not matches:
        return []

    # Extract (x, y) coordinates of matches and round them
    points = np.array([keypoints[match.trainIdx].pt for match in matches])
    rounded_points = np.round(points).astype(int)  # Round and convert to integers
    print(f"Points being clustered (rounded): {rounded_points}")  # Debugging

    # Apply DBSCAN clustering
    clustering = DBSCAN(eps=eps, min_samples=min_samples).fit(points)
    print(f"Cluster labels: {clustering.labels_}")  # Debugging

    # Visualize clusters
    unique_labels = set(clustering.labels_)
    for cluster_label in unique_labels:
        if cluster_label == -1:  # Noise
            continue
        cluster_indices = np.where(clustering.labels_ == cluster_label)[0]
        print(f"Cluster {cluster_label}: {len(cluster_indices)} points")  # Debugging

    # Extract one representative match per cluster
    filtered_matches = []
    for cluster_label in unique_labels:
        if cluster_label == -1:  # Noise
            continue
        cluster_indices = np.where(clustering.labels_ == cluster_label)[0]
        filtered_matches.append(matches[cluster_indices[0]])

    return filtered_matches


# Iterate over each card
for card_file in os.listdir(card_dir):
    if card_file.endswith('.jpg'):
        card_path = os.path.join(card_dir, card_file)
        card_image = cv2.imread(card_path, 0)  # Load in grayscale
        original_card_image = cv2.imread(card_path)  # Load in color for visualization

        print(f"Processing card: {card_file}")

        # Detect and compute keypoints and descriptors for the card
        card_keypoints, card_descriptors = sift.detectAndCompute(card_image, None)

        # Match each template
        for template_name, (template_keypoints, template_descriptors) in template_features.items():
            if template_descriptors is None or card_descriptors is None:
                print(f"Skipping template {template_name} due to missing descriptors.")
                continue

            # Get the threshold for the current template
            ratio_threshold = distance_thresholds.get(template_name, default_threshold)

            # Match descriptors using FLANN
            matches = flann.knnMatch(template_descriptors, card_descriptors, k=2)

            # Apply Lowe's ratio test with variable threshold
            good_matches = []
            for m, n in matches:
                if m.distance < ratio_threshold * n.distance:
                    good_matches.append(m)

            # Cluster matches to remove duplicates
            clustered_matches = cluster_matches(good_matches, card_keypoints, eps=50, min_samples=1)

            # Categorize matches and visualize
            gather_reagents = []
            increase_value = []
            template_height, template_width = template_dimensions[template_name]  # Get template dimensions

            for match in clustered_matches:
                x, y = card_keypoints[match.trainIdx].pt
                if y < card_image.shape[0] // 2:  # Top half (red background)
                    gather_reagents.append((x, y))
                else:  # Bottom half (blue background)
                    increase_value.append((x, y))

            # Create a fresh copy of the original image for each template
            color_card_image = original_card_image.copy()

            # Draw bounding boxes for matches
            for (x, y) in gather_reagents:
                top_left = (int(x - template_width // 2), int(y - template_height // 2))
                bottom_right = (int(x + template_width // 2), int(y + template_height // 2))
                cv2.rectangle(color_card_image, top_left, bottom_right, (0, 255, 0), 2)  # Green for Gather Reagents

            for (x, y) in increase_value:
                top_left = (int(x - template_width // 2), int(y - template_height // 2))
                bottom_right = (int(x + template_width // 2), int(y + template_height // 2))
                cv2.rectangle(color_card_image, top_left, bottom_right, (255, 0, 0), 2)  # Blue for Increase Value

            # Show the image with matches for the current template
            print(f"  Template: {template_name}")
            print(f"    Gather Reagents Matches: {len(gather_reagents)}")
            print(f"    Increase Value Matches: {len(increase_value)}")
            cv2.imshow(f"Matches for {template_name}", color_card_image)

            # Pause and wait for key press
            print("Press any key to continue to the next template...")
            cv2.waitKey(0)

        cv2.destroyAllWindows()
