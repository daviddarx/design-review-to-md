# Expend non local review

- I am really happy how our tool now works: on a project, I can reference to this repo, and add the npm run review script, which will allow me to hit ctrl+r on a local url (iframe of the project repo, surrounded from our tool) and make review which are direclty added in the project repo into doc/review.
- Now, I'd like to use this tool for website that are remote: deployed branch of collegues, which are displayed after a login.
- I would like to have a command, which I can run in this repo, and which ask, wich website I want to review.
- I provide the url, in which I am already logged in my chrome.
- The script wrap this in our review tool, and serve me a localhost url where I can review the pages, as I would do locally.
- Is it possible to have the given url in the iframe wihtout having to log in again, in chrome?
- Differences with the current flow:
  - Instead of being created in a local repo, the review folder with md files, screenshots, pins, etc are created on my desktop: normalized-url/review-round/...
  - When I start again this script, maybe later, when the collegue did the changes and sent me back the URL, it will check on my desktop if exisiting review for this url and take take them as a source, allow me to follow/refine the review
  - In this workflow/mode, we won't have the "to review step", as this comes from claude in my local repo, and the collegue's claude won't be able to change this by my place.
  - In this mode, the "Copy prompt" button should rather be "finalize review": doing this, it will:
    - add an index.html file in the normalized-url/review-round/... listing all the corrections: screenshot, number (1, 1.a, etc) and descrption, so that my collgue can have an visual overview without having the tool installed by himslef (sidebar crlt+r)
    - add a readme.md which is actually the text which would have been copied with "copy prompt", and a adapter copy of the skill, which tell the collegue agent what to do (no mention of the "to review" step, only what I necessary for my colleuge. )
- Questions:
  - Currently, the system is working very well, with several pin on several pages, even in overlays, etc, it will retrieve the page state to display the pin. Is it also possible with a remote url?
- I am surely forgetting aspects, spot for them.
