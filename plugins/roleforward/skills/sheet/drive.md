# The Drive Folder and Docs

Read this when the user turns the Drive folder on, or asks for a posting's packet or their interview prep as a Google Doc. What a sync does with Docs is in the sheet skill's Sync section.

With `drive.enabled` true in `workspace.yaml`, the sheet lives in a Google Drive folder, "<person.name> Career", with an Archive folder inside it. On request, the folder also holds a few Google Docs, so the user can read them in a browser or on a phone: **Interview Prep** (the workspace's prep file) and a **packet** for any posting they're interested in or have applied to. A packet holds the fit analysis, the company's bottom line and interview questions, the form answers (without voluntary self-identification, which stays in the workspace), the posting's prep plan, and, once frozen, the text of the resume that was sent.

A Doc is made only when the user asks ("put the Intuit packet in Drive"), never by a sync, because each Doc passes through the conversation in full (about 12,000 tokens for a typical packet). Say so the first time in a session.

- **Set up the folder** (once, when the module is turned on): create the folder with Drive `create_file` (mime type `application/vnd.google-apps.folder`), the Archive folder inside it, and move the sheet in with `update_file` (`parentId`). Save `drive.folder_id` and `drive.archive_id` in `workspace.yaml`.
- **Make a Doc:** run `node <tools>/docs.mjs list` for the keys (`prep`, or a posting's Record ID). Run `node <tools>/docs.mjs markdown <key>`: its first line is the title, and the rest is the content. Upload the content with Drive `create_file`: `contentMimeType: "text/markdown"`, `textContent` set to the content, the title, and `parentId` set to `drive.folder_id`. Drive converts it into a Google Doc. Then run `node <tools>/docs.mjs record <key> --doc <id>`.
- **A fresh copy replaces the old one.** The connectors can't replace a Doc's content, so an update is a new Doc. `record` prints the previous copy's ID: trash it with Drive `trash_file` (Google keeps it in the trash for 30 days). This is the one deletion the plugin makes, and only of a Doc it made, so say it in one line when it happens.
- **At each sync,** run `node <tools>/docs.mjs list`. A Doc whose posting has ended moves to the Archive folder (`update_file` with `parentId` set to `drive.archive_id`, then `docs.mjs record <key> --archived`), which costs nothing. A Doc marked "the workspace has changed since" isn't remade: mention it once, and remake it only if the user asks.
- **The sheet links to each packet:** with a packet made, the posting's Role cell on Shortlist and History links to it (`sheet.mjs rows` writes the link).
- **The sent resume PDF:** the connectors can't upload a PDF practically, since the whole file would pass through the conversation. When a posting is frozen, tell the user they can drag its PDF into the folder themselves, and give its path.

