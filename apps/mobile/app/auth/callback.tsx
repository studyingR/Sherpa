import { Redirect } from 'expo-router';

/** Landing route for the OAuth redirect; the browser session hands the URL back to signInWithGoogle(). */
export default function AuthCallback() {
  return <Redirect href="/sign-in" />;
}
