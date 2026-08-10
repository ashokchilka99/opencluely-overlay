require('dotenv').config();

const llmService = require('../src/services/llm.service');

// Exercises the configured LLM provider end to end — connection probe, a
// streaming answer, and a non-streaming answer — without booting Electron.
async function main() {
  const stats = llmService.getStats();

  console.log('LLM provider:', stats.provider);
  console.log('Model:', stats.model);
  console.log('Initialized:', stats.isInitialized);
  console.log('Config:', JSON.stringify(stats.config, null, 2));

  if (!stats.isInitialized) {
    console.error(
      `\nNo usable API key for "${stats.provider}". ` +
      `Set ${stats.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} in .env.`
    );
    process.exitCode = 1;
    return;
  }

  const connection = await llmService.testConnection();
  console.log('\nConnection test:', JSON.stringify(connection, null, 2));
  if (!connection.success) {
    process.exitCode = 1;
    return;
  }

  const question = 'Reverse a singly linked list. Give the approach and the code.';

  console.log('\n--- Streaming response ---');
  const streamStart = Date.now();
  let firstDeltaAt = null;
  const streamed = await llmService.processTextWithSkillStream(
    question,
    'dsa',
    [],
    'cpp',
    (delta) => {
      if (firstDeltaAt === null) firstDeltaAt = Date.now() - streamStart;
      process.stdout.write(delta);
    }
  );
  console.log('\n--- End of stream ---');
  console.log('First token after:', `${firstDeltaAt}ms`);
  console.log('Total time:', `${Date.now() - streamStart}ms`);
  console.log('Characters:', (streamed.response || '').length);

  console.log('\n--- Non-streaming response ---');
  const blockingStart = Date.now();
  const blocking = await llmService.processTextWithSkill(
    'In one sentence, what is a hash map?',
    'dsa',
    [],
    'cpp'
  );
  console.log(blocking.response);
  console.log('Total time:', `${Date.now() - blockingStart}ms`);

  console.log('\nAll checks passed.');
}

main().catch((error) => {
  console.error('\nTest failed:', error.message);
  process.exit(1);
});
