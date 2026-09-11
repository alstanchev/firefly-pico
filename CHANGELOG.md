# Changelog

## 0.2.4-dev6

- Receipt scanning has its own popup: tap the camera, choose whether to
  split into items, add the photos and they are interpreted right away,
  with no Interpret step. The Dictate popup no longer accepts photos.
- Each receipt photo is framed in a crop step before it is read, and a
  thumbnail can be tapped to adjust the frame and scan again. The cropped
  area is cut from the full photo before downscaling, so small print stays
  legible.
- With "Split into items" on, a scanned receipt becomes one Firefly split
  transaction with one split per purchased item. The items must add up
  exactly to the receipt total; any difference is shown on the draft and
  fixed in its editor (edit, add, delete or merge the items) before
  creating. Receipts booked with a foreign amount stay one transaction
  with the items in notes.
- New assistant setting "Split receipts into items by default", off by
  default; it only sets the chip's starting state for each scan.

## 0.2.4-dev5

- Opening or swiping to a transaction from the list shows it instantly
  from the already loaded data, refreshing from the backend silently.

## 0.2.4-dev4

- Swiping between transactions in view mode is animated: the form
  follows the finger and the next transaction slides in.
- The back arrow on a viewed transaction returns to the transaction list
  even after swiping through several transactions.

## 0.2.4-dev3

- Labels and values stay fully legible in the transaction view mode
  instead of being greyed out.

## 0.2.4-dev2

- View mode of a transaction no longer shows clear marks, chevrons,
  required-field asterisks or convert buttons, and its pickers stay
  closed until Edit is pressed.
- While viewing, swipe left / right to move to the next / previous
  transaction of the list; the desktop layout gets arrow buttons in the
  toolbar.

## 0.2.4-dev1

Development build from the `dev` branch: everything in 0.2.3 rebased on
the latest upstream Firefly Pico, which brings:

- Virtual balances are shown for accounts that define one.
- Split transactions display all of their parts in full.
- Amounts are formatted while typing in the amount input.
- Markdown notes have better contrast in the dark theme.
- The account selector no longer loses its value after a background
  sync, and select options update reactively.
- The transaction list count is correct when splits are used.
- The web server port inside the container can be changed with
  `NGINX_PORT` (not needed for the add-on, which keeps port 80).

## 0.2.3

- Opening an existing transaction now shows it read-only, with an Edit
  button to unlock the form. Saving returns it to view mode.
- Receipt images open in a full-screen preview with pinch-to-zoom
  instead of downloading.
- Split transactions no longer offer an Edit button that leads to a
  disabled form.
- Attachments can't be uploaded or deleted while a transaction is in
  view mode, and long notes are shown in full instead of truncated.

## 0.2.2

- Category and tag pickers on the transaction form can create a new
  entry on the spot: type a name that doesn't exist and tap the
  "Create" row to add it and select it, without leaving the form.
- When the receipt assistant reads a category or tag name that doesn't
  match anything in the store, the name is no longer dropped: the
  draft card shows it as not found, and opening the picker pre-types
  it so it's one tap away from being created.

## 0.2.1

- Receipt scanning: a camera button inside the dictate popup so more
  photos can be taken one after another, up to three per ramble.
- Several photos can belong to one transaction (a long receipt, or a
  receipt with its invoice) and all of them are attached to it.
- Every item line the assistant writes into the notes carries its price.

## 0.2.0

- Add-on options for the AI assistant: LLM and transcription API key,
  endpoint, model, context and language, mapped to the `ASSISTANT_*`
  environment variables.
- Receipt scanning: attach up to three receipt photos to a ramble; the
  assistant reads them and the photos are attached to the created
  transactions. The camera button sits next to the dictate button.
- Settings > Assistant: pick the LLM model from the models the key can use,
  and see the provider's full response when a test fails.

## 0.1.1

- Build: install git in the composer stage so package downloads fall back to
  cloning when GitHub's zipball API is unreachable.

## 0.1.0

- First release as a Home Assistant add-on, built from source on the host.
