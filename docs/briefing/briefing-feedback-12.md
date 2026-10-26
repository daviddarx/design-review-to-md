## Design Review Tool - Feedback.

- Actually, when an item is created, the use case is mainly to refine it with the refine function.
- The real edit of an item with subitems isn't a use-case, and anyways, the items and subitems are very quickly not editable anymore ("Claude has worked on this — use Refine in the list.")
- So, in the feedback list, completely remove the edit button. Instead
  - Add the delete icon which was present on the edit drawer to each item/sub-items, at the right of it's action group.
  - When user make refine:
    - add option to add aditional pins (like we had in the edit drawer)
    - add option to add additional files (like we had in the edit drawer)
    - make the save button have primary style
  - When pins are shown with the toggle of an item/subitem, then user case hover them to remove them, like while the edit drawer.
  - The only thing we loose: ability to add sub-items to an existing items structure. But it's ok. User will refine or create new first level item.
