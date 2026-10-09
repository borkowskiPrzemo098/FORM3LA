import { MODE } from './config.js';
import { createDemoStore } from './store-demo.js';

let instance;

export async function getStore() {
  if (instance) return instance;
  if (MODE === 'supabase') {
    const { createSupabaseStore } = await import('./store-supabase.js');
    instance = await (await createSupabaseStore()).init();
  } else {
    instance = await createDemoStore().init();
  }
  return instance;
}
