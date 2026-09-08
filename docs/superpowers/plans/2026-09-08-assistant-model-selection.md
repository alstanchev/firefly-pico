# Assistant Model Selection and Inline Test Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the full LLM/transcription test result inline in the Assistant settings panel, and let each profile pick the LLM model from the list the configured OpenAI-compatible API actually offers.

**Architecture:** The backend gains one read-only route, `GET assistant/models`, that derives the provider's models URL from the configured chat endpoint and returns the sorted model ids, plus an optional `model` request field on the interpret and test endpoints that overrides the env model. The frontend stores the chosen model as a profile setting (like the existing "Additional LLM context"), loads the list in the settings page through the repository, hides ids that clearly cannot chat, and sends the selection with every interpret and test call. Test results are kept in component state and rendered under the test buttons instead of relying on a toast alone.

**Tech Stack:** Laravel 12 + PHPUnit (Http fake), Nuxt 3 / Vue 3 `<script setup>` plain JS, Vant 4 via the repo's `app-select` ui-kit component, Pinia + VueUse `useLocalStorage`.

**Spec:** Inline. See "Design summary" below (approved in chat on 2026-09-08).

## Global Constraints

- Follow `AGENTS.md`: least necessary change, plain JS, Prettier style (single quotes, no semicolons, trailing commas, printWidth 200), no `<style>` blocks (CSS in `front/assets/styles/theme-white.css` with a dark override in `theme-dark.css`), i18n for every label in ALL 11 locale files under `front/i18n/locales/` (`de-DE, en, es-MX, fr, it, ko, pl, pt-BR, ro, ru-RU, zh-CN`), `fget()`/`fcollect()` not `data_get()`/`collect()` in PHP, `lodash-es` only, toasts via `UIUtils`, no new dependencies.
- OpenAI only. The models URL is derived by replacing a trailing `/chat/completions` in `ASSISTANT_LLM_ENDPOINT` with `/models`; an endpoint that does not end that way returns a 422 with a clear message.
- The env model `ASSISTANT_LLM_MODEL` (default `gpt-4o-mini`) stays the default. An empty selection means "server default". Existing users who never select anything see no behaviour change.
- Hidden model ids: any id containing `whisper`, `tts`, `transcribe`, `embedding`, `dall-e`, `moderation`, `realtime`, or `image` (case-insensitive). No hardcoded list of allowed models anywhere.
- Backend tests run with `php artisan test --filter AssistantRambleTest` (on this machine through the Docker wrapper the controller provides). Frontend has no unit test runner: verify with per-file `npx eslint` / `npx prettier --check` and `npm run build` from `front/`. Repo-wide `npm run lint` fails at baseline and must not be run with `--fix`.
- Commit after each task. Commit message style: short and lowercase, e.g. `- load assistant models from the llm api`.

---

## Design summary

**Inline test results.** In `front/pages/settings/assistant.vue` each of the two test buttons keeps its toast and additionally records the outcome in component state (`llmTestResult`, `transcriptionTestResult`, each `null | { success: boolean, message: string }`). A result line under the button shows a green success text or a red box with the full backend message (for example OpenAI's "You have no credits remaining…"). The line persists until the next test or navigation. The repository's test calls pass `showErrorToast: false` so the interceptor's own toast does not duplicate the panel message.

**Model list.** `GET api/assistant/models` → `{ data: string[] }` sorted model ids from the provider. The settings page loads it on mount when the LLM is configured, filters hidden ids, and shows an `app-select` (single column, searchable, clearable) bound to the new profile setting `assistantLlmModel` (string, `''` = server default). The select's placeholder reads "Server default (gpt-4o-mini)". If the list cannot be loaded the select is not rendered and the error appears in the LLM result line. The existing "LLM model" detail row shows the effective model: the selection if set, else the server value.

**Model override.** `POST api/assistant/interpret-transactions` and `POST api/assistant/test-llm` accept an optional top-level `model` string; when non-empty it replaces the configured model in the outgoing payload. The frontend sends `profileStore.assistantLlmModel` on both.

**Out of scope.** Transcription model selection; a server-wide setting; per-model capability detection beyond the name filter.

---

### Task 1: Backend models route and model override

**Files:**
- Modify: `back/routes/api.php` (assistant routes block, after the `assistant/test-transcription` line)
- Modify: `back/app/Http/Controllers/AssistantController.php` (`interpretTransactions`, `testLlm`, new `getModels`, new private `resolveModel`)
- Test: `back/tests/Feature/AssistantRambleTest.php` (extend the `Http::fake` in `setUp`; add four tests)

**Interfaces:**
- Produces: `GET api/assistant/models` → `200 { "data": ["gpt-4o", "gpt-4o-mini", "whisper-1"] }` (sorted ascending, unique, non-empty ids only); `422 { message }` when the LLM is not configured or the endpoint does not end in `/chat/completions`; provider status + `{ message }` passthrough on provider errors; `502 { message }` on connection failure.
- Produces: `POST api/assistant/interpret-transactions` and `POST api/assistant/test-llm` read optional `model` (string, max 100) from the request body and use it as the payload `model` when non-empty.

- [ ] **Step 1: Extend the `Http::fake` in `setUp` with a models branch**

In `back/tests/Feature/AssistantRambleTest.php`, add a stub property next to `$transcriptionStub`:

```php
    // Tests override this to fake a different models-list outcome.
    private $modelsStub = null;
```

and inside the fake callback, before the `chat/completions` branch:

```php
            if (str_contains($request->url(), '/models')) {
                return $this->modelsStub ? ($this->modelsStub)() : Http::response(['data' => [['id' => 'whisper-1'], ['id' => 'gpt-4o-mini'], ['id' => 'gpt-4o'], ['id' => '']]]);
            }
```

- [ ] **Step 2: Write the four failing tests**

Append before the class's closing `}`:

```php
    public function test_get_models_returns_sorted_ids_from_the_provider()
    {
        config(['services.assistant_llm.endpoint' => 'https://llm.example.com/v1/chat/completions', 'services.assistant_llm.api_key' => 'llm-key']);

        $response = $this->getJson('api/assistant/models', $this->headers());

        $response->assertStatus(200)->assertExactJson(['data' => ['gpt-4o', 'gpt-4o-mini', 'whisper-1']]);
        Http::assertSent(fn($request) => $request->url() === 'https://llm.example.com/v1/models' && ($request->header('Authorization')[0] ?? '') === 'Bearer llm-key');
    }

    public function test_get_models_fails_when_the_endpoint_is_not_a_chat_completions_url()
    {
        config(['services.assistant_llm.endpoint' => 'https://llm.example.com/custom']);

        $response = $this->getJson('api/assistant/models', $this->headers());

        $response->assertStatus(422);
        Http::assertNotSent(fn($request) => str_contains($request->url(), '/models'));
    }

    public function test_get_models_passes_provider_errors_through()
    {
        config(['services.assistant_llm.endpoint' => 'https://llm.example.com/v1/chat/completions']);
        $this->modelsStub = fn() => Http::response(['error' => ['message' => 'Incorrect API key provided']], 401);

        $response = $this->getJson('api/assistant/models', $this->headers());

        $response->assertStatus(401)->assertJsonPath('message', 'Incorrect API key provided');
    }

    public function test_interpret_and_test_llm_use_the_requested_model()
    {
        config(['services.assistant_llm.endpoint' => 'https://llm.example.com/v1/chat/completions', 'services.assistant_llm.model' => 'gpt-4o-mini']);

        $this->postJson('api/assistant/interpret-transactions', [
            'model' => 'gpt-4.1',
            'payload' => ['messages' => [['role' => 'user', 'content' => 'coffee 5 eur']]],
        ], $this->headers())->assertStatus(200);
        $this->postJson('api/assistant/test-llm', ['model' => 'gpt-4.1'], $this->headers())->assertStatus(200);
        $this->postJson('api/assistant/test-llm', ['model' => ''], $this->headers())->assertStatus(200);

        $models = fcollect(Http::recorded(fn($request) => str_contains($request->url(), 'chat/completions')))->map(fn($pair) => $pair[0]['model'])->all();
        $this->assertSame(['gpt-4.1', 'gpt-4.1', 'gpt-4o-mini'], $models);
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `back/` (through the Docker wrapper on this machine):

```bash
php artisan test --filter 'test_get_models|test_interpret_and_test_llm_use_the_requested_model'
```

Expected: the three `get_models` tests FAIL with 404 (route missing); the model test FAILS because `gpt-4o-mini` is sent every time.

- [ ] **Step 4: Add the route**

In `back/routes/api.php`, after `Route::post('assistant/test-transcription', ...)`:

```php
Route::get('assistant/models', [AssistantController::class, 'getModels']);
```

- [ ] **Step 5: Implement the controller changes**

In `back/app/Http/Controllers/AssistantController.php`:

Change the validation and model line in `interpretTransactions`:

```php
        $request->validate([
            'payload' => ['required', 'array'],
            'payload.messages' => ['required', 'array'],
            'model' => ['nullable', 'string', 'max:100'],
        ]);
```

and replace `$payload['model'] = $config['model'];` with:

```php
        $payload['model'] = $this->resolveModel($request, $config);
```

In `testLlm`, add the same validation right after `BaseAuthorization::checkUser();`:

```php
        $request->validate(['model' => ['nullable', 'string', 'max:100']]);
```

and replace `'model' => $config['model'],` in its payload with `'model' => $this->resolveModel($request, $config),`.

Add the new public method after `testTranscription`:

```php
    public function getModels(Request $request)
    {
        BaseAuthorization::checkUser();
        $config = app(AssistantLlmConfigService::class)->getConfig();

        if (!$config['isConfigured']) {
            return $this->setStatusCode(self::HTTP_CODE_UNPROCESSABLE_ENTITY)->respond([
                'message' => 'Assistant LLM is not configured.',
            ]);
        }

        // OpenAI-compatible APIs expose the model list next to the chat endpoint.
        $modelsUrl = preg_replace('#/chat/completions/?$#', '/models', $config['endpoint'], 1, $replaced);
        if (!$replaced) {
            return $this->setStatusCode(self::HTTP_CODE_UNPROCESSABLE_ENTITY)->respond([
                'message' => 'ASSISTANT_LLM_ENDPOINT must end with /chat/completions to list models.',
            ]);
        }

        $request = Http::acceptJson()->connectTimeout(10)->timeout(30);
        if ($config['apiKey']) {
            $request = $request->withToken($config['apiKey']);
        }

        try {
            $response = $request->get($modelsUrl);
        } catch (ConnectionException $exception) {
            return $this->setStatusCode(502)->respond([
                'message' => $exception->getMessage() ?: 'Assistant LLM request failed.',
            ]);
        }

        if (!$response->successful()) {
            return $this->setStatusCode($response->status())->respond([
                'message' => fget($response->json(), 'error.message') ?? fget($response->json(), 'message') ?? 'Assistant LLM request failed.',
            ]);
        }

        $models = fcollect(fget($response->json(), 'data'))
            ->map(fn($item) => trim((string)fget($item, 'id')))
            ->filter()
            ->unique()
            ->sort()
            ->values();

        return $this->respond(['data' => $models]);
    }
```

and the private helper next to `appendContext`:

```php
    // A profile may pick a model in the app; otherwise the configured one is used.
    private function resolveModel(Request $request, $config)
    {
        $model = trim((string)$request->input('model'));

        return $model !== '' ? $model : $config['model'];
    }
```

`self::HTTP_CODE_UNPROCESSABLE_ENTITY` and `ConnectionException` are already used/imported in this file.

- [ ] **Step 6: Run the tests to verify they pass, then the whole assistant suite**

```bash
php artisan test --filter 'test_get_models|test_interpret_and_test_llm_use_the_requested_model'
php artisan test --filter AssistantRambleTest
```

Expected: all PASS, no warnings.

- [ ] **Step 7: Commit**

```bash
git add back/routes/api.php back/app/Http/Controllers/AssistantController.php back/tests/Feature/AssistantRambleTest.php
git commit -m "- list assistant models and accept a model override"
```

---

### Task 2: Profile setting, repository calls, and ramble wiring

**Files:**
- Modify: `front/stores/profileStore.js` (declare `assistantLlmModel` next to `assistantLlmContext` at line 29 and export it next to `assistantLlmContext` in the returned object near line 184)
- Modify: `front/repository/AssistantRepository.js` (`interpretTransactions`, `testLlm`, `testTranscription`, new `getModels`)
- Modify: `front/components/transaction/ramble.vue` (the `interpretTransactions({...})` call in `interpretRambleText`, line ~367)

**Interfaces:**
- Produces: `profileStore.assistantLlmModel` (string, `''` default, synced with the profile automatically because `getProfileSettings()` serialises the whole store state).
- Produces: `AssistantRepository.getModels()` → resolves to the axios response (`response.data.data` is the id array on success; `response.data.message` on failure; never rejects; no interceptor toast).
- Produces: `AssistantRepository.testLlm(model)` and `testTranscription()` no longer trigger the interceptor toast (`showErrorToast: false`); `testLlm` posts `{ model }`.
- Produces: `interpretTransactions(data)` sends `model: data.model` at the top level of the request body.

- [ ] **Step 1: Add the profile setting**

In `front/stores/profileStore.js`, after `const assistantLlmContext = useLocalStorage('assistantLlmContext', '')` add:

```js
  const assistantLlmModel = useLocalStorage('assistantLlmModel', '')
```

and in the returned object, after `assistantLlmContext,` add:

```js
    assistantLlmModel,
```

- [ ] **Step 2: Repository changes**

In `front/repository/AssistantRepository.js`:

In `interpretTransactions`, add `model: data.model,` to `requestData` right after `context: data.externalContext,`.

Replace the two test methods and add `getModels`:

```js
  async getModels() {
    return axios.get(`${this.getUrl()}/models`, { showErrorToast: false, timeout: 30000 })
  }

  async testLlm(model) {
    return axios.post(`${this.getUrl()}/test-llm`, { model }, { timeout: 60000, showErrorToast: false })
  }

  async testTranscription() {
    return axios.post(`${this.getUrl()}/test-transcription`, {}, { timeout: 120000, showErrorToast: false })
  }
```

`showErrorToast: false` is already honoured by the response interceptor in `front/plugins/axios.js` (`error.config?.showErrorToast !== false`).

- [ ] **Step 3: Send the selected model from the ramble popup**

In `front/components/transaction/ramble.vue`, in the `assistantRepository.interpretTransactions({...})` call, add after `externalContext: profileStore.assistantLlmContext,`:

```js
      model: profileStore.assistantLlmModel,
```

- [ ] **Step 4: Verify**

From `front/`:

```bash
npx eslint stores/profileStore.js repository/AssistantRepository.js components/transaction/ramble.vue
npx prettier --check stores/profileStore.js repository/AssistantRepository.js components/transaction/ramble.vue
npm run build
```

Expected: 0 eslint errors (the ramble file has no new warnings), prettier passes, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add front/stores/profileStore.js front/repository/AssistantRepository.js front/components/transaction/ramble.vue
git commit -m "- send the profile's llm model with assistant requests"
```

---

### Task 3: Settings panel: model select and inline test results

**Files:**
- Modify: `front/pages/settings/assistant.vue` (LLM card and transcription card templates; script state and handlers)
- Modify: `front/assets/styles/theme-white.css` (after the `.llm-env-chip` block, line ~1862)
- Modify: `front/assets/styles/theme-dark.css` (after the `.van-theme-dark .llm-status-pill-off` block, line ~375)
- Modify: all 11 locale files under `front/i18n/locales/`, inside `"settings" > "assistant"`, after `"transcription_test_failed"` (note this key is currently the LAST key in that object in every file, so it needs a trailing comma added)

**Interfaces:**
- Consumes: `profileStore.assistantLlmModel`, `AssistantRepository.getModels()`, `testLlm(model)`, `testTranscription()` from Task 2; `appStore.llmModel` / `appStore.llmIsConfigured` (existing).

- [ ] **Step 1: Add i18n keys to all 11 locale files**

Inside `"settings"."assistant"`, replace the current last line `"transcription_test_failed": "..."` (keep each file's own value for that line, `ko.json` has Korean text there) by adding a trailing comma and these keys after it. Use the English strings in every file:

```json
      "llm_model_select": "Model override",
      "llm_model_select_title": "Select LLM model",
      "llm_model_server_default": "Server default ({model})",
      "llm_models_load_failed": "Could not load the model list"
```

Validate all files parse, from `front/`:

```bash
for f in i18n/locales/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "ok $f"; done
```

- [ ] **Step 2: Template changes in `front/pages/settings/assistant.vue`**

In the LLM card, change the "LLM model" detail row value to show the effective model:

```html
              <span class="llm-detail-value cursor-pointer" :title="effectiveLlmModel" @click="showFullDetailValue(effectiveLlmModel)">{{ effectiveLlmModel }}</span>
```

(replace both `appStore.llmModel` references in that row with `effectiveLlmModel`).

Directly after the `</div>` closing the `llm-detail-panel` (still inside `v-if="appStore.llmIsConfigured"` territory), before the `<app-text-area ... assistant-llm-context ...>` line, add:

```html
          <app-select
            v-if="llmModels.length > 0"
            v-model="assistantLlmModel"
            v-model:show-dropdown="isDropdownLlmModelVisible"
            :label="$t('settings.assistant.llm_model_select')"
            :popup-title="$t('settings.assistant.llm_model_select_title')"
            :placeholder="$t('settings.assistant.llm_model_server_default', { model: appStore.llmModel })"
            :list="llmModels"
            :columns="1"
            :has-search="true"
            :icon="TablerIconConstants.magic"
          />
```

Replace the LLM test button block with a block that also renders the result:

```html
          <div v-if="appStore.llmIsConfigured" class="display-flex flex-column gap-2">
            <div class="flex-center">
              <van-button round size="small" plain :loading="isTestingLlm" @click="testLlm">
                <app-icon :icon="TablerIconConstants.magic" :size="16" />
                {{ $t('settings.assistant.llm_test') }}
              </van-button>
            </div>
            <div v-if="llmTestResult" class="llm-test-result word-break-word" :class="llmTestResult.success ? 'llm-test-result-ok' : 'llm-test-result-error'">{{ llmTestResult.message }}</div>
          </div>
```

Replace the transcription test button block the same way:

```html
          <div v-if="appStore.transcriptionIsConfigured" class="display-flex flex-column gap-2">
            <div class="flex-center">
              <van-button round size="small" plain :loading="isTestingTranscription" @click="testTranscription">
                <app-icon :icon="TablerIconConstants.microphone" :size="16" />
                {{ $t('settings.assistant.transcription_test') }}
              </van-button>
            </div>
            <div v-if="transcriptionTestResult" class="llm-test-result word-break-word" :class="transcriptionTestResult.success ? 'llm-test-result-ok' : 'llm-test-result-error'">{{ transcriptionTestResult.message }}</div>
          </div>
```

- [ ] **Step 3: Script changes in `front/pages/settings/assistant.vue`**

Add state after `const isTestingTranscription = ref(false)`:

```js
const assistantLlmModel = ref('')
const llmModels = ref([])
const isDropdownLlmModelVisible = ref(false)
const llmTestResult = ref(null)
const transcriptionTestResult = ref(null)

// Ids the provider lists but which cannot answer a chat request. The list itself is never hardcoded.
const hiddenModelPattern = /whisper|tts|transcribe|embedding|dall-e|moderation|realtime|image/i

const effectiveLlmModel = computed(() => assistantLlmModel.value || appStore.llmModel)
```

Add `{ store: profileStore, path: 'assistantLlmModel', ref: assistantLlmModel },` to `syncedSettings` after the `assistantLlmContext` entry.

Add the loader and change the two test handlers:

```js
const loadLlmModels = async () => {
  if (!appStore.llmIsConfigured) {
    return
  }

  const response = await new AssistantRepository().getModels()
  if (ResponseUtils.isSuccess(response)) {
    llmModels.value = (response.data?.data ?? []).filter((id) => !hiddenModelPattern.test(id))
    return
  }

  llmModels.value = []
  llmTestResult.value = { success: false, message: `${t('settings.assistant.llm_models_load_failed')}: ${response?.data?.message ?? ''}`.trim() }
}

const testLlm = async () => {
  isTestingLlm.value = true
  llmTestResult.value = null
  const response = await new AssistantRepository().testLlm(assistantLlmModel.value)
  isTestingLlm.value = false

  const success = ResponseUtils.isSuccess(response)
  const message = success ? t('settings.assistant.llm_test_success') : (response?.data?.message ?? t('settings.assistant.llm_test_failed'))
  llmTestResult.value = { success, message }
  success ? UIUtils.showToastSuccess(message) : UIUtils.showToastError(message)
}

const testTranscription = async () => {
  isTestingTranscription.value = true
  transcriptionTestResult.value = null
  const response = await new AssistantRepository().testTranscription()
  isTestingTranscription.value = false

  const success = ResponseUtils.isSuccess(response)
  const message = success ? t('settings.assistant.transcription_test_success') : (response?.data?.message ?? t('settings.assistant.transcription_test_failed'))
  transcriptionTestResult.value = { success, message }
  success ? UIUtils.showToastSuccess(message) : UIUtils.showToastError(message)
}
```

In `onMounted`, add `loadLlmModels()` (no await needed) before `animateSettings()`.

Add `computed` to the existing `import { onMounted, ref } from 'vue'` line.

- [ ] **Step 4: CSS**

`front/assets/styles/theme-white.css`, after the `.llm-env-chip { ... }` block:

```css
.llm-test-result {
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.4;
}

.llm-test-result-ok {
    color: #1b8a4a;
    background: var(--income3);
}

.llm-test-result-error {
    color: var(--expense1);
    background: var(--expense3);
}
```

`front/assets/styles/theme-dark.css`, after the `.van-theme-dark .llm-status-pill-off { ... }` block:

```css
.van-theme-dark .llm-test-result-ok {
    color: #7bd28a;
    background: rgba(102, 187, 106, 0.18);
}

.van-theme-dark .llm-test-result-error {
    color: #ff8aa8;
    background: rgba(236, 64, 122, 0.16);
}
```

- [ ] **Step 5: Verify**

From `front/`:

```bash
npx eslint pages/settings/assistant.vue
npx prettier --check pages/settings/assistant.vue i18n/locales/*.json
npm run build
```

Expected: 0 eslint errors, prettier passes for the page and the locale files (the CSS files fail prettier at baseline and are not checked), build succeeds.

Read-through checks to state in the report: the select renders only when at least one model loaded; clearing the select stores `''` so the server default applies; the effective model row updates immediately on selection; a failed models load leaves `llmModels` empty and shows the message in the LLM result line; `onSave` still persists via `saveSettingsToStore` (the new synced entry covers it).

- [ ] **Step 6: Commit**

```bash
git add front/pages/settings/assistant.vue front/assets/styles/theme-white.css front/assets/styles/theme-dark.css front/i18n/locales/
git commit -m "- select the llm model in settings and show test results inline"
```

---

## Self-review notes

- Coverage: inline results (Task 3), models route + override (Task 1), setting + transport (Task 2), select UI + filter (Task 3). Out-of-scope items are not covered by design.
- Names across tasks: `assistantLlmModel` (Task 2 store → Task 3 page and Task 2 ramble); `getModels()` / `testLlm(model)` (Task 2 → Task 3); request field `model` (Task 1 ↔ Task 2); response shape `{ data: string[] }` (Task 1 ↔ Task 3 `response.data.data`).
- Known uncertainty: `app-select` passes unknown attributes through to `van-field`; the `:icon` prop is used elsewhere in the repo on `app-field` and may be ignored by `app-select`. It is harmless either way; the implementer should drop it if eslint or the build complains.
