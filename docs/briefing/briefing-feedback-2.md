## Design Review Tool - Feedback.

- Feedback list:
  - Display the pill for the state at the right, with the actions. Make it's height have the same height as the action button (but do not change font-size. )
  - Buttons for manually uploaded files: do not place a button with emoji. Add an icon similar like the screenshot icon in the right actions. on hover of it, display a tooltop, bottom right aligned, with the list of links for the uploded files.
  - When there is sub-points, make that the border top between the sub-point and its parent point horizontally starts at the same position as the text of the parent point. The line isn't touching the left side of the panel anymore.
  - The tooltip for screenshot is too wide, there is blank part aside the screenshot. It should display only the image, with a shadow, without blank on the sides.
  - Right actions: put the edit button always on the right.
  - In the iddle state, dispaly all pins on the app
    - When toggling a specific one (hover or click toggle), hide the other one.
  - Header copied promp state: add a check icon before the "copied"
- New feedback drawer:
  - When a file is uploaded, remove the emoji, and change the style, it's too similar to the input. Use only grey background, like for the tag on the feedback list.
  - On creation of a feedback, display out the existing pins of the other points.
  - Increase indentation of fields by 8px.
  - Screenshot darg and drop: extand the draggable area to the full feedback point (or subpoint, subsubpoint): update highlight too.
- Generally:
  - Increase the gutter width of module by 8px on the left and right.
  - Remove the white background of the header, everything grey.
  - Give all the colors a blueish hue, like tailwinds slate.
