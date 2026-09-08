# Receipt Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user photograph a receipt with their phone inside the existing "Dictate transactions" (ramble) popup, have OpenAI read it, and get a pre-filled transaction draft with the original photo attached to the created Firefly III transaction.

**Architecture:** The backend `interpret-transactions` endpoint already forwards whatever `messages` array the frontend builds to the configured OpenAI chat-completions endpoint, appends server/user context to the system message, and sets the model. OpenAI chat models accept images as `image_url` content parts in the user message, so receipt scanning is done entirely in the frontend: compress the photo on a canvas, embed it as a base64 data URL in the user message, extend the existing system prompt with receipt rules, and reuse the existing JSON parsing, name resolution, draft editing and creation flow unchanged. After a draft is created, the photo is uploaded through the existing `AttachmentRepository`. No new backend endpoints, jobs, migrations or environment variables.

**Tech Stack:** Nuxt 3 / Vue 3 `<script setup>` (plain JS, no TS), Vant 4, Tabler icons, lodash-es, Laravel 12 + PHPUnit (one characterization test), OpenAI chat completions API (`gpt-4o-mini` default, any current OpenAI chat model with image input).

**Spec:** Inline. See "Design summary" below. It was derived in-session from reading the code; there is no separate spec document.

## Global Constraints

- Follow `AGENTS.md` at the repo root. Highlights that apply here: least necessary change, no new npm/composer dependencies, no TypeScript, no `<style scoped>` (CSS goes in `front/assets/styles/theme-white.css` with a dark override in `theme-dark.css`), no hard-coded labels (add i18n keys to ALL 10 locale files), Prettier style (single quotes, no semicolons, `printWidth: 200`), `lodash-es` only, `UIUtils` for toasts, `fget()` not `data_get()` in PHP.
- OpenAI only. No local LLM, no OCR engine switch, no vision-model env var. The configured `ASSISTANT_LLM_MODEL` (default `gpt-4o-mini`) is used for both text and receipt interpretation.
- Existing behaviour for text-only and voice rambles must not change. When no photo is attached the request body must be byte-for-byte what it is today (user `content` stays a string).
- Request size budget: the Docker image ships PHP defaults (`post_max_size` 8M, no php.ini override in `Dockerfile`), nginx allows 50m, and the LLM proxy has a 60 s timeout (`AssistantController::sendLlmRequest`) matched by a 60 s axios timeout. Therefore photos are downscaled client-side to max 1600 px on the long side, JPEG quality 0.8, and at most 3 photos per ramble.
- Frontend has no unit test runner. Frontend tasks are verified with `npm run lint`, `npm run build` (from `front/`) and manual checks in the browser. Say so honestly in commit messages and reports; do not claim automated coverage that does not exist.
- Backend verified with `php artisan test --filter AssistantRambleTest` from `back/`.
- Commit after each task. Commit message style in this repo is short and lowercase, e.g. `- add receipt scanning to ramble`.

---

## Design summary

**User flow**

1. User opens the ramble popup (the sparkle button next to the assistant card), taps a new camera button in the composer card.
2. The native file picker opens with `accept="image/*"` and no `capture` attribute, so iOS offers "Take Photo / Photo Library" and Android offers camera or gallery. Up to 3 images.
3. Each image is decoded, downscaled and re-encoded to JPEG in the browser, shown as a 64 px thumbnail with a remove button.
4. "Interpret" is enabled when there is text, saved rambles, or at least one photo. The request sends the usual JSON text part plus one `image_url` part per photo with `detail: 'high'` (small receipt print needs it).
5. The system prompt gains receipt rules and a `receiptIndex` field so each transaction says which photo it came from.
6. Drafts appear and are edited/created exactly as today. After each successful create, the matching photo is uploaded as a Firefly attachment on that transaction's journal.

**Data shapes**

- Receipt item held in `ramble.vue` and edited by `ramble-input-card.vue`:
  `{ id: string, file: File /* image/jpeg */, dataUrl: string /* data:image/jpeg;base64,... */ }`
- `AssistantRepository.interpretTransactions(data)` gains an optional `data.receiptImages: string[]` (data URLs).
- Normalised transaction gains `receiptIndex: number|null`. The resolver keeps the raw object on `raw`, so drafts expose it as `draft.assistant.raw.receiptIndex`.

**Attachment mapping rule**

- If `receiptIndex` is an integer that points at a captured photo, attach that photo.
- Else if exactly one photo was captured, attach it.
- Else attach nothing (ambiguous; the user can attach manually later).

**Out of scope (deliberately)**

- Persisting photos on `assistant_rambles` and a queue job (only useful for the Siri-shortcut path, which does not send photos).
- Tesseract / classic OCR fallback (only useful for text-only local models).
- Merchant-to-category learning.

---

### Task 1: Backend characterization test for image content parts

The backend needs no code change. This test locks in the two proxy behaviours the frontend will rely on: a user message whose `content` is an array is forwarded untouched, and context is still appended to the system message.

**Files:**
- Modify: `back/tests/Feature/AssistantRambleTest.php` (the `setUp` `Http::fake` callback at lines 25-38, and append one test method before the final closing brace)

**Interfaces:**
- Consumes: `POST api/assistant/interpret-transactions` with `{ context, payload: { messages } }` as implemented in `AssistantController::interpretTransactions`.
- Produces: nothing for later tasks; documents the contract Task 3 builds against.

- [ ] **Step 1: Add a chat-completions branch to the `Http::fake` in `setUp`**

In `back/tests/Feature/AssistantRambleTest.php`, change the fake callback so it also answers LLM calls. The existing transcription branch stays as is:

```php
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'audio/transcriptions')) {
                return $this->transcriptionStub ? ($this->transcriptionStub)() : Http::response(['text' => 'voice transcription']);
            }

            if (str_contains($request->url(), 'chat/completions')) {
                return Http::response(['choices' => [['message' => ['content' => '{"transactions":[]}']]]]);
            }

            return match ($request->header('Authorization')[0] ?? $request->header('authorization')[0] ?? '') {
                'Bearer test-token' => Http::response(['data' => ['id' => '1']]),
                'Bearer other-token' => Http::response(['data' => ['id' => '2']]),
                default => Http::response(null, 401),
            };
        });
```

- [ ] **Step 2: Add the test method**

Append before the class's closing `}`:

```php
    public function test_interpret_transactions_forwards_image_content_parts_and_appends_context()
    {
        config([
            'services.assistant_llm.endpoint' => 'https://llm.example.com/v1/chat/completions',
            'services.assistant_llm.model' => 'gpt-4o-mini',
        ]);

        $userContent = [
            ['type' => 'text', 'text' => '{"text":"lidl"}'],
            ['type' => 'image_url', 'image_url' => ['url' => 'data:image/jpeg;base64,/9j/AAAA', 'detail' => 'high']],
        ];

        $response = $this->postJson('api/assistant/interpret-transactions', [
            'context' => 'Return descriptions in English',
            'payload' => [
                'messages' => [
                    ['role' => 'system', 'content' => 'You extract transactions.'],
                    ['role' => 'user', 'content' => $userContent],
                ],
            ],
        ], $this->headers());

        $response->assertStatus(200)->assertJsonPath('choices.0.message.content', '{"transactions":[]}');

        Http::assertSent(function ($request) use ($userContent) {
            return str_contains($request->url(), 'llm.example.com')
                && $request['model'] === 'gpt-4o-mini'
                && $request['messages'][1]['content'] === $userContent
                && str_contains($request['messages'][0]['content'], 'Return descriptions in English');
        });
    }
```

- [ ] **Step 3: Run the test**

Run from `back/`:

```bash
php artisan test --filter test_interpret_transactions_forwards_image_content_parts_and_appends_context
```

Expected: PASS. This is a characterization test of existing behaviour, so it passes without production changes. If it fails, the frontend approach in Task 3 is not viable and the plan must be revisited before continuing.

- [ ] **Step 4: Run the whole assistant suite to make sure the fake change broke nothing**

```bash
php artisan test --filter AssistantRambleTest
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add back/tests/Feature/AssistantRambleTest.php
git commit -m "- test that the llm proxy forwards image content parts"
```

---

### Task 2: Client-side image compression utility

**Files:**
- Create: `front/utils/ImageUtils.js`

**Interfaces:**
- Produces:
  - `compressImageToJpeg(file, { maxSide = 1600, quality = 0.8 } = {})` → `Promise<Blob>` (type `image/jpeg`). Throws `Error` if the image cannot be decoded or encoded.
  - `blobToDataUrl(blob)` → `Promise<string>`.

- [ ] **Step 1: Create the utility**

```js
// Receipt photos come straight from the phone camera at several MB each.
// The backend runs PHP defaults (8M post limit) and the LLM proxy times out at 60 s,
// so photos are downscaled and re-encoded here before they are sent anywhere.

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    // from-image applies the EXIF rotation so portrait receipts are not sent sideways.
    return createImageBitmap(file, { imageOrientation: 'from-image' })
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Image could not be decoded'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const compressImageToJpeg = async (file, { maxSide = 1600, quality = 0.8 } = {}) => {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) {
    throw new Error('Image could not be encoded')
  }

  return blob
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
```

- [ ] **Step 2: Lint**

Run from `front/` (run `npm install` first if `node_modules` is missing):

```bash
npm run lint
```

Expected: no errors for `utils/ImageUtils.js`.

- [ ] **Step 3: Manual smoke check in the browser console**

Start the app with `npm run dev` from `front/`, open it, and in devtools run:

```js
const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
input.onchange = async () => {
  const { compressImageToJpeg, blobToDataUrl } = await import('/utils/ImageUtils.js')
  const blob = await compressImageToJpeg(input.files[0])
  console.log(input.files[0].size, '->', blob.size, (await blobToDataUrl(blob)).slice(0, 40))
}
input.click()
```

Pick a photo larger than 1600 px. Expected: the second size is well under 1 MB and the data URL starts with `data:image/jpeg;base64,`. (If the dynamic import path does not resolve under the dev server, skip this and rely on the end-to-end check in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add front/utils/ImageUtils.js
git commit -m "- add client-side image compression util for receipt photos"
```

---

### Task 3: Send receipt images to the LLM and read back `receiptIndex`

**Files:**
- Modify: `front/repository/AssistantRepository.js` (prompt at lines 6-24, `normalizeTransactions` at lines 55-92, `interpretTransactions` at lines 128-165)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interpretTransactions(data)` accepts optional `data.receiptImages` (array of data URL strings). When present and non-empty, the user message `content` becomes an array of `{ type: 'text', text }` followed by `{ type: 'image_url', image_url: { url, detail: 'high' } }` parts. When absent or empty the request is unchanged from today.
  - Each normalised transaction has `receiptIndex: number|null`.

- [ ] **Step 1: Extend the JSON shape and add receipt rules to the prompt**

In `getInterpretationPrompt`, change the shape line to include `receiptIndex`:

```js
    '{"amount": number|null, "currencyCode": string|null, "description": string, "tagNames": string[], "categoryName": string|null, "templateName": string|null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string|null, "type": "expense|income|transfer|null", "occurredAt": string|null, "notes": string|null, "receiptIndex": number|null}',
```

Then append these lines at the end of the array (after the `'Prefer type expense unless ...'` line):

```js
    'The user message may also contain one or more receipt photos. Read each photo and extract its purchase as one transaction: description is the merchant name as printed, amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered), currencyCode from the printed currency or the merchant country, occurredAt from the printed date and time, type expense. Put the purchased items in notes, one per line as "item price". Set receiptIndex to the 0-based position of the photo the transaction came from; leave it null for transactions that come from the text.',
    'When the text and a photo describe the same purchase, return a single transaction and let the text override the photo. If a photo is not a receipt or is unreadable, do not invent a transaction for it.',
```

- [ ] **Step 2: Pass `receiptIndex` through `normalizeTransactions`**

In the object returned by the `.map(...)` in `normalizeTransactions`, add after `notes`:

```js
        receiptIndex: Number.isInteger(transaction.receiptIndex) ? transaction.receiptIndex : Number.isInteger(transaction.receipt_index) ? transaction.receipt_index : null,
```

- [ ] **Step 3: Build the user content with image parts**

Add this helper above `export default class AssistantRepository`:

```js
const buildUserContent = (data) => {
  const text = JSON.stringify({
    text: data.text,
    savedRambles: data.savedRambles ?? [],
    now: data.now,
    timezone: data.timezone,
    language: data.language,
    context: data.context ?? {},
  })

  const receiptImages = data.receiptImages ?? []
  if (receiptImages.length === 0) {
    return text
  }

  // Small receipt print is only legible to the model at high detail.
  return [{ type: 'text', text }, ...receiptImages.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))]
}
```

Then in `interpretTransactions`, replace the user message so it uses the helper:

```js
          {
            role: 'user',
            content: buildUserContent(data),
          },
```

and delete the inline `JSON.stringify({...})` block that was there.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Verify text-only requests are unchanged**

With `npm run dev` running and the LLM configured on the backend, open the ramble popup, type `coffee 5 eur`, press Interpret, and inspect the request to `/api/assistant/interpret-transactions` in devtools. Expected: `payload.messages[1].content` is a string, exactly as before this task.

- [ ] **Step 6: Commit**

```bash
git add front/repository/AssistantRepository.js
git commit -m "- send receipt photos to the llm as image content parts"
```

---

### Task 4: Camera button and thumbnails in the composer card

**Files:**
- Modify: `front/components/transaction/ramble/ramble-input-card.vue` (button row at lines 4-44, text area at lines 66-74, script)
- Modify: `front/constants/TablerIconConstants.js` (icon map, near the `microphone` entry at line 60)
- Modify: `front/plugins/plugin-register-tabler-icons.js` (import list and component registrations)
- Modify: `front/assets/styles/theme-white.css` (after `.ramble-saved-item` block at line 1714)
- Modify: `front/assets/styles/theme-dark.css` (after `.van-theme-dark .ramble-header-icon` block at line 352)
- Modify: all 10 locale files in `front/i18n/locales/` (`en.json`, `ro.json`, `zh-CN.json`, `it.json`, `pt-BR.json`, `de-DE.json`, `fr.json`, `pl.json`, `ru-RU.json`, `es-MX.json`), inside the `"transaction"` object after `"assistant_ramble_edit_title"`

**Interfaces:**
- Consumes: `compressImageToJpeg`, `blobToDataUrl` from Task 2.
- Produces: a named model on the card, `v-model:receipts`, holding an array of `{ id, file, dataUrl }`. The card enables Interpret when receipts are present. Task 5 binds this model.

- [ ] **Step 1: Register the camera icon**

In `front/constants/TablerIconConstants.js`, add next to `microphone`:

```js
  camera: 'IconCamera',
```

In `front/plugins/plugin-register-tabler-icons.js`, add `IconCamera,` to the import list from `@tabler/icons-vue` and add this registration next to the `IconMicrophone` line:

```js
  nuxtApp.vueApp.component('IconCamera', IconCamera)
```

- [ ] **Step 2: Add i18n keys to all 10 locale files**

Add these four keys inside `"transaction"` right after `"assistant_ramble_edit_title"` in every locale file. Use the English strings in every file; that matches how the other `assistant_ramble_*` keys are stored today (e.g. `de-DE.json` has `"assistant_ramble_interpret": "Interpret"`).

```json
    "assistant_ramble_scan_receipt": "Scan receipt",
    "assistant_ramble_receipt": "Receipt photo",
    "assistant_ramble_receipt_failed": "The photo could not be processed. Use a JPEG or PNG image.",
    "assistant_ramble_receipt_limit": "You can attach up to {count} receipt photos",
```

Mind the trailing comma on the line before (`"assistant_ramble_edit_title": "...",`) and check whether the last of the four needs a trailing comma depending on what follows it in that file.

Validate every file parses, from `front/`:

```bash
for f in i18n/locales/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "ok $f"; done
```

Expected: `ok` for all 10 files.

- [ ] **Step 3: Add the camera button and hidden file input to the button row**

In `ramble-input-card.vue`, inside the first `<div class="flex-center-vertical flex-wrap gap-2">`, insert between `<div class="flex-1" />` and the desktop-only microphone button:

```html
        <van-button round size="small" class="cursor-pointer ramble-icon-button" :disabled="isDisabled" :loading="isPreparingReceipts" :title="$t('transaction.assistant_ramble_scan_receipt')" @click="receiptInputRef?.click()">
          <app-icon :icon="TablerIconConstants.camera" :size="16" />
        </van-button>
        <input ref="receiptInputRef" type="file" accept="image/*" multiple hidden @change="onReceiptsSelected" />
```

No `capture` attribute on purpose: with it, iOS forces the camera and hides the photo library.

- [ ] **Step 4: Add the thumbnail strip**

Insert directly after the closing `</div>` of the saved-rambles list (`v-if="savedRambles.length > 0"`) and before `<app-text-area`:

```html
      <div v-if="receipts.length > 0" class="display-flex flex-wrap gap-2">
        <div v-for="receipt in receipts" :key="receipt.id" class="ramble-receipt-thumb">
          <img :src="receipt.dataUrl" :alt="$t('transaction.assistant_ramble_receipt')" />
          <van-button round size="mini" type="danger" class="cursor-pointer ramble-receipt-remove" :disabled="isDisabled" :title="$t('delete')" @click="removeReceipt(receipt)">
            <app-icon :icon="TablerIconConstants.close" :size="12" />
          </van-button>
        </div>
      </div>
```

- [ ] **Step 5: Add the script logic**

Add imports at the top of `<script setup>`:

```js
import { compressImageToJpeg, blobToDataUrl } from '~/utils/ImageUtils.js'
import { getGUID } from '~/utils/Utils.js'
import UIUtils from '~/utils/UIUtils.js'
```

After `const rambleText = defineModel({ type: String, default: '' })` add:

```js
const receipts = defineModel('receipts', { type: Array, default: () => [] })
const { t } = useI18n()
```

Replace the `canInterpret` computed with:

```js
const canInterpret = computed(() => !!rambleText.value.trim() || props.savedRambles.length > 0 || receipts.value.length > 0)
```

Add the receipt handling near `toggleRecording`:

```js
// Three photos keep the base64 request well under PHP's 8M post limit and the 60 s LLM timeout.
const maxReceipts = 3
const receiptInputRef = ref(null)
const isPreparingReceipts = ref(false)

const onReceiptsSelected = async (event) => {
  const selected = Array.from(event.target.files ?? [])
  event.target.value = ''

  const files = selected.slice(0, Math.max(0, maxReceipts - receipts.value.length))
  if (selected.length > files.length) {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_limit', { count: maxReceipts }))
  }
  if (files.length === 0) {
    return
  }

  isPreparingReceipts.value = true
  try {
    const prepared = []
    for (const file of files) {
      const blob = await compressImageToJpeg(file)
      const jpeg = new File([blob], `receipt-${Date.now()}-${prepared.length}.jpg`, { type: 'image/jpeg' })
      prepared.push({ id: getGUID(), file: jpeg, dataUrl: await blobToDataUrl(jpeg) })
    }
    receipts.value = [...receipts.value, ...prepared]
  } catch {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_failed'))
  } finally {
    isPreparingReceipts.value = false
  }
}

const removeReceipt = (receipt) => {
  receipts.value = receipts.value.filter((item) => item.id !== receipt.id)
}
```

The `try/catch` here wraps image decoding, not an axios call, so it does not conflict with the repo rule about API errors.

- [ ] **Step 6: Add the CSS**

In `front/assets/styles/theme-white.css`, after the `.ramble-saved-item { ... }` block:

```css
.ramble-receipt-thumb {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #eee;
}

.ramble-receipt-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.van-button.ramble-receipt-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    padding: 0;
}
```

In `front/assets/styles/theme-dark.css`, after the `.van-theme-dark .ramble-header-icon { ... }` block:

```css
.van-theme-dark .ramble-receipt-thumb {
    border-color: #444;
}
```

- [ ] **Step 7: Lint and build**

From `front/`:

```bash
npm run lint:fix && npm run build
```

Expected: lint clean, build succeeds.

- [ ] **Step 8: Manual check**

With `npm run dev`, open the ramble popup. Expected: a camera button appears in the composer row on both mobile-width and desktop layouts; choosing one or more images shows 64 px thumbnails with a working remove button; a fourth image triggers the limit toast; the Interpret button becomes enabled with only a photo and no text. Check both light and dark themes.

- [ ] **Step 9: Commit**

```bash
git add front/components/transaction/ramble/ramble-input-card.vue front/constants/TablerIconConstants.js front/plugins/plugin-register-tabler-icons.js front/assets/styles/theme-white.css front/assets/styles/theme-dark.css front/i18n/locales/
git commit -m "- add receipt photo capture to the ramble composer"
```

---

### Task 5: Wire receipts through interpretation and attach photos after create

**Files:**
- Modify: `front/components/transaction/ramble.vue` (input card binding at lines 29-41, imports at lines 93-108, state at lines 128-146, `resetRamble` at line 296, `interpretRambleText` at line 345, `createRambleTransactions` success branch at lines 463-468)

**Interfaces:**
- Consumes: `v-model:receipts` from Task 4; `data.receiptImages` and `receiptIndex` from Task 3; `AttachmentRepository.uploadForTransaction(journalId, file)` (existing).
- Produces: end-to-end feature.

- [ ] **Step 1: Bind the receipts model**

Add to the `<ramble-input-card ... />` element:

```html
            v-model:receipts="rambleReceipts"
```

- [ ] **Step 2: Imports and state**

Change the lodash import to:

```js
import { cloneDeep, get } from 'lodash-es'
```

Add:

```js
import AttachmentRepository from '~/repository/AttachmentRepository.js'
```

After `const rambleText = ref('')` add:

```js
const rambleReceipts = ref([])
```

In `resetRamble`, after `rambleText.value = ''` add:

```js
  rambleReceipts.value = []
```

- [ ] **Step 3: Allow interpreting with only photos and send them**

In `interpretRambleText`, change the early return to:

```js
  const text = getInterpretationText()
  if (!text && rambleReceipts.value.length === 0) {
    return
  }
```

and add to the `interpretTransactions({...})` call, after `context: getRambleContext(),`:

```js
      receiptImages: rambleReceipts.value.map((receipt) => receipt.dataUrl),
```

- [ ] **Step 4: Attach the photo after a successful create**

Add these two functions above `createRambleTransactions`:

```js
const getReceiptsForTransaction = (transaction) => {
  const receiptIndex = transaction.assistant?.raw?.receiptIndex
  if (Number.isInteger(receiptIndex) && rambleReceipts.value[receiptIndex]) {
    return [rambleReceipts.value[receiptIndex]]
  }

  // Without a usable index, only an unambiguous single photo is attached.
  return rambleReceipts.value.length === 1 ? rambleReceipts.value : []
}

const attachReceipts = async (transaction) => {
  const journalId = get(transaction.response, 'data.data.attributes.transactions.0.transaction_journal_id')
  if (!journalId) {
    return
  }

  for (const receipt of getReceiptsForTransaction(transaction)) {
    await new AttachmentRepository().uploadForTransaction(journalId, receipt.file)
  }
}
```

In `createRambleTransactions`, inside `if (isResponseSuccessful(response)) { ... }`, after `rambleTransactions.value[transactionIndex].response = response` and before `successCount += 1`, add:

```js
          await attachReceipts(rambleTransactions.value[transactionIndex])
```

`uploadForTransaction` already shows its own success toast and cleans up if the upload fails, so no extra handling is needed here. A failed attachment must not mark the transaction as failed; the transaction exists in Firefly either way.

- [ ] **Step 5: Lint and build**

From `front/`:

```bash
npm run lint:fix && npm run build
```

Expected: clean.

- [ ] **Step 6: Verify the journal id path**

With `npm run dev`, create any transaction through the ramble popup and inspect the response of `POST /api/transactions` in devtools. Expected: `data.data.attributes.transactions[0].transaction_journal_id` is present. If the path differs, fix the `get()` path in `attachReceipts` to match what you see.

- [ ] **Step 7: Commit**

```bash
git add front/components/transaction/ramble.vue
git commit -m "- interpret receipt photos and attach them to created transactions"
```

---

### Task 6: Document the feature

**Files:**
- Modify: `readme.md` (feature list near line 63, the line starting `- ✅ The Assistant makes recording an expense feel like magic`)

**Interfaces:** none.

- [ ] **Step 1: Add a feature bullet**

Directly after the Assistant bullet add:

```markdown
- ✅ Snap a photo of a receipt in the Dictate popup and let the assistant fill in the transaction (uses the same OpenAI LLM configuration; the photo is attached to the transaction)
```

- [ ] **Step 2: Commit**

```bash
git add readme.md
git commit -m "- document receipt scanning"
```

The public documentation site lives in a separate repository (`cioraneanu/firefly-pico-docs`). Note in the final report that its assistant page should mention receipt scanning; that change is outside this repo.

---

### Task 7: End-to-end verification with a real OpenAI key

No code changes. This is the only test of the actual OpenAI behaviour, so it is mandatory before calling the feature done.

**Files:** none.

- [ ] **Step 1: Configure the backend**

In `back/.env` (never commit it) set:

```
ASSISTANT_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
ASSISTANT_LLM_MODEL=gpt-4o-mini
ASSISTANT_LLM_API_KEY=<your key>
```

Run `php artisan serve` from `back/` and `npm run dev` from `front/`, and make sure the Settings > Assistant page shows the LLM as configured and "Test LLM configuration" succeeds.

- [ ] **Step 2: Single receipt, no text**

Open the ramble popup on a phone (or a desktop browser with a receipt photo file). Attach one clear receipt photo, press Interpret. Expected: one draft with the merchant as description, the printed total as amount, the printed date, item lines in notes. Press Create. Expected: the transaction appears in the list, and its detail page shows the receipt as an attachment.

- [ ] **Step 3: Receipt plus text override**

Attach the same receipt and type `groceries tag food`. Expected: still one draft, with the food tag applied. Create and confirm the attachment.

- [ ] **Step 4: Two receipts**

Attach two different receipts, Interpret. Expected: two drafts. Create both. Expected: each transaction has its own receipt attached (relies on `receiptIndex`). If both photos land on the same transaction or none, the model did not return `receiptIndex`; check the raw response content in devtools and tighten the prompt line in Task 3 Step 1.

- [ ] **Step 5: Non-receipt photo**

Attach a photo of something that is not a receipt, Interpret. Expected: "No transactions found", no crash.

- [ ] **Step 6: Regression**

Text-only ramble and a saved voice ramble still interpret and create as before.

- [ ] **Step 7: Record results**

Report which of steps 2 to 6 passed, with the model's actual JSON for any failures. Do not claim success for a step you did not run.

---

## Self-review notes

- Coverage: capture (Task 4), compression (Task 2), request shape and prompt (Task 3), proxy contract (Task 1), attach-after-create and photo-only interpret (Task 5), docs (Task 6), real-model verification (Task 7). The design summary's out-of-scope list is intentionally not covered.
- Names used across tasks: `compressImageToJpeg`, `blobToDataUrl` (Task 2 → Task 4); `receipts` model / `rambleReceipts` ref (Task 4 ↔ Task 5); `data.receiptImages` and `receiptIndex` (Task 3 → Task 5); `TablerIconConstants.camera` (Task 4). Locale keys `assistant_ramble_scan_receipt`, `assistant_ramble_receipt`, `assistant_ramble_receipt_failed`, `assistant_ramble_receipt_limit` are referenced only in Task 4.
- Known uncertainty: the journal id path in Task 5 Step 4 is inferred from `transaction-attachments-list.vue`, which reads `attributes.transactions.0.transaction_journal_id` from a transaction object. Task 5 Step 6 verifies it against the live response.
