import { connect } from 'lumiana/client';

// Connect with credentials and launch your app
const lumiana = await connect.credentials({
  username: 'lumiana',
  password: 'lumiana',
});

lumiana.run(() => import('./entry.ts'));