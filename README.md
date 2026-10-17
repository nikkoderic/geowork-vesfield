# VES Field

An offline-first progressive web app for recording GPS locations during VES surveys. It is a static site and can be hosted directly from GitHub Pages.

## Publish on GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**, then select the branch and folder containing `index.html` (usually `main` and `/ (root)`). Once published, open the Pages URL on the phone. The first visit needs an internet connection so the app shell can be cached; afterward, projects and survey records remain available offline. GPS access requires HTTPS, which GitHub Pages provides.

On Android, use the browser's **Install app** prompt or **Add to Home screen**. On iPhone, use Safari's **Share → Add to Home Screen**.

The currently running app version is shown at the bottom of the screen. After publishing a new version to GitHub Pages, the browser checks for it and **Update app** appears in the top bar when the new service worker takes control. Tap it to reload the updated app. The button cannot publish source changes that have not yet been deployed. If there is no connection, the installed version remains available offline and no update can be detected until the app reconnects.

## Working with projects

The app opens to the point-acquisition screen, which immediately shows the live GPS position. Select a project, site, and station on that screen to see distance and azimuth relative to the station coordinates and enable A/B point capture. The selected project, site, and station IDs appear below their selectors. Create any missing level with the adjacent **+** controls. New projects are named **VES Project 1**, **VES Project 2**, and so on by default, continuing after existing default-named projects. On the acquisition screen, acquired points appear before station coordinates and setup. When adding a station, **Use current GPS position as station coordinates** is selected by default; uncheck it to set coordinates later. The app prominently prompts for coordinates when they are unset, and point capture remains unavailable until they are set. Use **Station setup** from acquisition or station browsing to enter latitude/longitude manually, fill them from GPS, and edit target azimuths A and B. Coordinates are validated as decimal degrees (latitude −90 to 90, longitude −180 to 180); setup changes require confirmation. Each captured point stores its timestamp, coordinates, GPS accuracy, distance and azimuth from the station, and selected target.

When a station with coordinates is selected on the acquisition screen, use **Share QR** to display its project/site/station IDs and station setup. QR sharing is unavailable until station coordinates are set. On the other device, choose **Scan QR** and scan the displayed code. Missing project/site/station structure is created using those same IDs, including station coordinates and target azimuths; existing records remain intact, and the receiving device selects the opposite A/B target. If the matched station already has different coordinates or azimuths, the app asks before replacing them. The code includes hierarchy names, station coordinates, target azimuths, and the sender's selected A/B side, but not acquired points. QR creation and scanning work offline; camera access requires browser permission and a secure origin such as the HTTPS GitHub Pages site. The scanner requests continuous autofocus when supported; tap the camera preview to refocus on devices that support tap-to-focus.

Use **Browse records** to review projects and sites. Opening a station shows its acquired-point list and **Station setup**, the same editor available during acquisition. Enter decimal-degree coordinates directly or use **Acquire GPS coordinates** to fill both coordinate fields from a GPS fix; edit target azimuths in that editor as well. Changes require confirmation before they are saved. Choose **Acquire points** to return to the capture screen with that station selected. The capture screen also shows the station's point history. GPS operations reuse a very recent live fix when available; otherwise, getting a high-accuracy fix can take several seconds, and the app shows a progress indicator while it waits.

The north-up field map plots station coordinates, current GPS position, recorded points, and both target directions over a north/east coordinate grid. Grid interval and scale adjust to include the most distant plotted position. A compact compass rotates its north marker with the device and shows the selected target relative to the device's heading; a heading marker also appears at the current position. Compass starts automatically where supported. Some browsers require permission from a button. If the browser only provides relative orientation rather than a north-referenced compass heading, the map labels it as approximate.

Map colors distinguish the station (green), current position (black), target A (cyan), and target B (magenta with a dashed direction line).

Use **Export CSV** to download a project-wide table with rows for every station, station coordinates, and recorded point; the default filename is the project name with a `.csv` extension. **Share / sync** sends a versioned project JSON file using the phone's share sheet where supported; otherwise it downloads the file. The default filename is the project name with a `.vesfield.json` extension. Import that file on another device to merge records with the same project ID. This is an offline file-transfer workflow, not live synchronization.

Project, station, and individual recorded-point deletion each require confirmation before removing local data. If the system share sheet denies access or sharing is unavailable, the app automatically downloads the project file instead.

### Bluetooth limitation

Browser PWA APIs do not let a web app act as a Bluetooth LE GATT server. Direct BLE phone-to-phone synchronization therefore requires a native app or a separate BLE device/service. On supported phones, the system share sheet may offer Bluetooth as a way to send the exported project file, which can then be imported by the receiving device.

## Local data and privacy

Project data is stored in the browser's IndexedDB on the current device. It is not uploaded to a server. Clearing browser/site storage removes the local copy, so export/share backups before clearing it or changing devices.
