<?php

namespace Tests\Feature;

use App\Jobs\TranscribeAssistantRamble;
use App\Models\AssistantRamble;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AssistantRambleTest extends TestCase
{
    use RefreshDatabase;

    private $token = 'test-token';

    // Tests override this to fake a different transcription outcome.
    private $transcriptionStub = null;

    // Tests override this to fake a different models-list outcome.
    private $modelsStub = null;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'audio/transcriptions')) {
                return $this->transcriptionStub ? ($this->transcriptionStub)() : Http::response(['text' => 'voice transcription']);
            }

            if (str_contains($request->url(), '/models')) {
                return $this->modelsStub ? ($this->modelsStub)() : Http::response(['data' => [['id' => 'whisper-1'], ['id' => 'gpt-4o-mini'], ['id' => 'gpt-4o'], ['id' => '']]]);
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
    }

    private function createVoiceRamble($userId = '1', $text = null)
    {
        $path = 'assistant-rambles/' . uniqid() . '.m4a';
        Storage::disk('local')->put($path, 'fake-audio');

        return AssistantRamble::create(['text' => $text, 'voice_path' => $path, 'user_id' => $userId]);
    }

    private function transcriptionField($name)
    {
        $request = Http::recorded(fn($request) => str_contains($request->url(), 'audio/transcriptions'))->first()[0] ?? null;

        return fcollect($request?->data())->firstWhere('name', $name)['contents'] ?? null;
    }

    private function headers($token = null)
    {
        return ['Authorization' => 'Bearer ' . ($token ?? $this->token)];
    }

    public function test_create_ramble_with_json_body()
    {
        $response = $this->postJson('api/assistant/rambles', ['text' => 'coffee 5 eur'], $this->headers());

        $response->assertOk();
        $this->assertDatabaseHas('assistant_rambles', [
            'text' => 'coffee 5 eur',
            'user_id' => '1',
        ]);
    }

    public function test_create_ramble_with_plain_text_body()
    {
        $response = $this->call('POST', 'api/assistant/rambles', [], [], [], $this->transformHeadersToServerVars($this->headers() + ['Content-Type' => 'text/plain']), 'coffee 5 eur');

        $response->assertOk();
        $this->assertDatabaseHas('assistant_rambles', ['text' => 'coffee 5 eur']);
    }

    public function test_create_ramble_without_text_fails()
    {
        $response = $this->postJson('api/assistant/rambles', [], $this->headers());

        $response->assertStatus(422);
        $this->assertDatabaseCount('assistant_rambles', 0);
    }

    public function test_create_ramble_with_voice_upload()
    {
        $file = UploadedFile::fake()->create('voice.m4a', 10, 'audio/mp4');

        $response = $this->post('api/assistant/rambles', ['voice' => $file], $this->headers());

        $response->assertOk()->assertJsonPath('data.has_voice', true);
        $ramble = AssistantRamble::first();
        $this->assertNotNull($ramble->voice_path);
        $this->assertNull($ramble->text);
        Storage::disk('local')->assertExists($ramble->voice_path);
    }

    public function test_create_ramble_with_voice_queues_transcription_job()
    {
        Queue::fake();
        config(['queue.default' => 'redis']);
        $file = UploadedFile::fake()->create('voice.m4a', 10, 'audio/mp4');

        $this->post('api/assistant/rambles', ['voice' => $file], $this->headers())->assertOk();

        Queue::assertPushed(TranscribeAssistantRamble::class);
    }

    public function test_create_ramble_with_voice_transcribes_after_response_on_sync_queue()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $file = UploadedFile::fake()->createWithContent('voice.m4a', 'fake-audio');

        $this->post('api/assistant/rambles', ['voice' => $file], $this->headers())->assertOk();

        $ramble = AssistantRamble::first();
        $this->assertTrue($ramble->is_transcribed);
        $this->assertSame('voice transcription', $ramble->text);
    }

    public function test_create_ramble_with_non_audio_voice_fails()
    {
        $file = UploadedFile::fake()->create('voice.txt', 10, 'text/plain');

        $this->post('api/assistant/rambles', ['voice' => $file], ['Accept' => 'application/json'] + $this->headers())->assertStatus(422);
        $this->assertDatabaseCount('assistant_rambles', 0);
    }

    public function test_get_rambles_transcribes_voice_ramble_only_once()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())
            ->assertOk()
            ->assertJsonPath('data.0.text', 'voice transcription')
            ->assertJsonPath('data.0.is_transcribed', true);

        $this->getJson('api/assistant/rambles', $this->headers())->assertOk();

        $transcriptionRequests = Http::recorded(fn($request) => str_contains($request->url(), 'audio/transcriptions'));
        $this->assertCount(1, $transcriptionRequests);
    }

    public function test_get_rambles_appends_transcription_to_existing_text()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->createVoiceRamble('1', 'typed text');

        $this->getJson('api/assistant/rambles', $this->headers())
            ->assertOk()
            ->assertJsonPath('data.0.text', "typed text\nvoice transcription");
    }

    public function test_get_rambles_skips_transcription_when_not_configured()
    {
        $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())
            ->assertOk()
            ->assertJsonPath('data.0.is_transcribed', false);

        $transcriptionRequests = Http::recorded(fn($request) => str_contains($request->url(), 'audio/transcriptions'));
        $this->assertCount(0, $transcriptionRequests);
    }

    public function test_transcription_sends_configured_language()
    {
        config([
            'services.assistant_transcription.api_key' => 'transcription-key',
            'services.assistant_transcription.language' => 'ro-RO',
        ]);
        $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())->assertOk();

        $this->assertSame('ro', $this->transcriptionField('language'));
    }

    public function test_transcription_language_is_omitted_when_not_configured()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())->assertOk();

        $this->assertNull($this->transcriptionField('language'));
    }

    public function test_create_ramble_language_overrides_configured_language()
    {
        config([
            'services.assistant_transcription.api_key' => 'transcription-key',
            'services.assistant_transcription.language' => 'ro',
        ]);
        $file = UploadedFile::fake()->createWithContent('voice.m4a', 'fake-audio');

        $this->post('api/assistant/rambles', ['voice' => $file, 'language' => 'de'], $this->headers())->assertOk();

        $this->assertSame('de', $this->transcriptionField('language'));
    }

    public function test_empty_transcription_deletes_the_ramble_and_its_voice_file()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->transcriptionStub = fn() => Http::response(['text' => '   ']);
        $ramble = $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())->assertOk()->assertJsonCount(0, 'data');

        $this->assertDatabaseCount('assistant_rambles', 0);
        Storage::disk('local')->assertMissing($ramble->voice_path);
    }

    public function test_empty_transcription_keeps_a_ramble_that_already_has_text()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->transcriptionStub = fn() => Http::response(['text' => '']);
        $this->createVoiceRamble('1', 'typed text');

        $this->getJson('api/assistant/rambles', $this->headers())
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.text', 'typed text');
    }

    public function test_failed_transcription_keeps_the_ramble_for_a_later_retry()
    {
        config(['services.assistant_transcription.api_key' => 'transcription-key']);
        $this->transcriptionStub = fn() => Http::response(['error' => ['message' => 'boom']], 500);
        $ramble = $this->createVoiceRamble();

        $this->getJson('api/assistant/rambles', $this->headers())
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.is_transcribed', false);
        Storage::disk('local')->assertExists($ramble->voice_path);

        $this->transcriptionStub = null;
        $this->getJson('api/assistant/rambles', $this->headers())->assertOk()->assertJsonPath('data.0.text', 'voice transcription');
    }

    public function test_previously_emptied_rambles_are_cleaned_up_and_not_counted()
    {
        $ramble = $this->createVoiceRamble();
        $ramble->update(['is_transcribed' => true]);

        $this->getJson('api/assistant/rambles/count', $this->headers())->assertOk()->assertJson(['count' => 0]);
        $this->getJson('api/assistant/rambles', $this->headers())->assertOk()->assertJsonCount(0, 'data');

        $this->assertDatabaseCount('assistant_rambles', 0);
        Storage::disk('local')->assertMissing($ramble->voice_path);
    }

    public function test_get_ramble_voice_streams_file_and_is_scoped_to_user()
    {
        $mine = $this->createVoiceRamble('1');
        $other = $this->createVoiceRamble('2');

        $this->get("api/assistant/rambles/{$mine->id}/voice", $this->headers())->assertOk();
        $this->get("api/assistant/rambles/{$other->id}/voice", $this->headers())->assertNotFound();
    }

    public function test_delete_ramble_deletes_voice_file()
    {
        $ramble = $this->createVoiceRamble();

        $this->deleteJson("api/assistant/rambles/{$ramble->id}", [], $this->headers())->assertOk();
        Storage::disk('local')->assertMissing($ramble->voice_path);
    }

    public function test_delete_rambles_by_ids_deletes_voice_files()
    {
        $ramble = $this->createVoiceRamble();

        $this->deleteJson('api/assistant/rambles', ['ids' => [$ramble->id]], $this->headers())->assertOk()->assertJson(['deleted' => 1]);
        Storage::disk('local')->assertMissing($ramble->voice_path);
    }

    public function test_create_ramble_without_valid_token_fails()
    {
        $response = $this->postJson('api/assistant/rambles', ['text' => 'coffee 5 eur']);

        $response->assertStatus(401);
        $this->assertDatabaseCount('assistant_rambles', 0);
    }

    public function test_count_and_list_are_scoped_to_user()
    {
        AssistantRamble::create(['text' => 'mine', 'user_id' => '1']);
        AssistantRamble::create(['text' => 'other', 'user_id' => '2']);

        $this->getJson('api/assistant/rambles/count', $this->headers())->assertOk()->assertJson(['count' => 1]);
        $this->getJson('api/assistant/rambles', $this->headers())->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.text', 'mine');
    }

    public function test_delete_rambles_by_ids()
    {
        $ramble = AssistantRamble::create(['text' => 'mine', 'user_id' => '1']);

        $this->deleteJson('api/assistant/rambles', ['ids' => [$ramble->id]], $this->headers())->assertOk()->assertJson(['deleted' => 1]);
        $this->assertDatabaseCount('assistant_rambles', 0);
    }

    public function test_delete_rambles_cannot_delete_other_users_rambles()
    {
        $mine = AssistantRamble::create(['text' => 'mine', 'user_id' => '1']);
        $other = AssistantRamble::create(['text' => 'other', 'user_id' => '2']);

        $this->deleteJson('api/assistant/rambles', ['ids' => [$mine->id, $other->id]], $this->headers())->assertOk()->assertJson(['deleted' => 1]);
        $this->assertDatabaseHas('assistant_rambles', ['id' => $other->id]);
    }

    public function test_delete_single_ramble_of_other_user_fails()
    {
        $other = AssistantRamble::create(['text' => 'other', 'user_id' => '2']);

        $this->deleteJson("api/assistant/rambles/{$other->id}", [], $this->headers())->assertNotFound();
        $this->assertDatabaseHas('assistant_rambles', ['id' => $other->id]);
    }

    public function test_delete_rambles_without_valid_token_fails()
    {
        $ramble = AssistantRamble::create(['text' => 'mine', 'user_id' => '1']);

        $this->deleteJson('api/assistant/rambles', ['ids' => [$ramble->id]])->assertStatus(401);
        $this->deleteJson("api/assistant/rambles/{$ramble->id}")->assertStatus(401);
        $this->assertDatabaseCount('assistant_rambles', 1);
    }

    public function test_interpret_transactions_without_valid_token_fails()
    {
        $response = $this->postJson('api/assistant/interpret-transactions', [
            'payload' => ['messages' => [['role' => 'user', 'content' => 'coffee 5 eur']]],
            'llm' => ['endpoint' => 'https://example.com/v1/chat/completions'],
        ]);

        $response->assertStatus(401);
        Http::assertNotSent(fn($request) => str_contains($request->url(), 'example.com'));
    }

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

        $models = fcollect(Http::recorded(fn($request) => str_contains($request->url(), 'chat/completions')))->map(fn($pair) => $pair[0]['model'])->values()->all();
        $this->assertSame(['gpt-4.1', 'gpt-4.1', 'gpt-4o-mini'], $models);
    }

    public function test_get_models_without_valid_token_fails()
    {
        config(['services.assistant_llm.endpoint' => 'https://llm.example.com/v1/chat/completions']);

        $response = $this->getJson('api/assistant/models');

        $response->assertStatus(401);
        Http::assertNotSent(fn($request) => str_contains($request->url(), '/models'));
    }
}
