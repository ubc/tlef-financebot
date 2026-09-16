# Course Materials: chat-first prototype

Open `/course-materials/`. The latest revision replaces the persistent file table with a full-height conversation and bottom composer. Drag files anywhere into the workspace or use Attach files. Sending demonstrates file cards, processing feedback and proposed LO connections inside the conversation.

Materials in the header opens the library on demand. Evidence and Review connections open the shared inspector with Preview, Learning objectives, Activity and Details. The green course sidebar is retained.

Try a sample upload, drag in a file, send a message, inspect evidence, save connections, open the library and switch Dark mode. New conversation clears messages but retains course files. Reset restores sample data.

All model responses, processing progress and highlighted passages are simulated. No files are uploaded and no server or LLM requests occur. Original document rendering and source-coordinate highlighting are not implemented by this prototype. The browser checks cover drag/drop, send, evidence, connection review, library access and 390px layout.

`library.js` contains the reusable inspector from the previous library-first direction. `chat.js` owns the current entry view.
