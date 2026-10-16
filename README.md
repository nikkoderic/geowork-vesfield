# VES Field

An offline-first progressive web app for recording GPS locations during VES surveys. It is a static site and can be hosted directly from GitHub Pages.

## Publish on GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**, then select the branch and folder containing `index.html` (usually `main` and `/ (root)`). Once published, open the Pages URL on the phone. The first visit needs an internet connection so the app shell can be cached; afterward, projects and survey records remain available offline. GPS access requires HTTPS, which GitHub Pages provides.

On Android, use the browser's **Install app** prompt or **Add to Home screen**. On iPhone, use Safari's **Share → Add to Home Screen**.

When online, use **Update app** in the top bar to check GitHub Pages for a newer version, install it, and reload the app. If there is no connection, the update check reports that it needs internet access; the installed version remains available offline.

## Working with projects

Create a project, add sites, and add VES stations inside each site. The station midpoint is captured from the device's GPS. Enter target azimuths A and B in degrees; choose the assigned target during fieldwork, and record a GPS point with the capture button. Each captured point includes its timestamp, coordinates, reported GPS accuracy, distance and azimuth from the midpoint, and selected target azimuth. The north-up field map plots the midpoint, current GPS position, previously recorded points, and both target directions over a north/east coordinate grid. Grid interval and scale adjust to include the most distant plotted position. A compact compass shows the selected target bearing, and—when device heading is available—a heading marker appears at the current position. Compass permission may be required.

Map colors distinguish the midpoint (green), current position (black), target A (cyan), and target B (magenta with a dashed direction line).

Use **Export CSV** to download a project-wide table with rows for every station, midpoint, and recorded point. **Share / sync** sends a versioned project JSON file using the phone's share sheet where supported; otherwise it downloads the file. Import that file on another device to merge records with the same project ID. This is an offline file-transfer workflow, not live synchronization.

Project, station, and individual recorded-point deletion each require confirmation before removing local data. If the system share sheet denies access or sharing is unavailable, the app automatically downloads the project file instead.

### Bluetooth limitation

Browser PWA APIs do not let a web app act as a Bluetooth LE GATT server. Direct BLE phone-to-phone synchronization therefore requires a native app or a separate BLE device/service. On supported phones, the system share sheet may offer Bluetooth as a way to send the exported project file, which can then be imported by the receiving device.

## Local data and privacy

Project data is stored in the browser's IndexedDB on the current device. It is not uploaded to a server. Clearing browser/site storage removes the local copy, so export/share backups before clearing it or changing devices.
