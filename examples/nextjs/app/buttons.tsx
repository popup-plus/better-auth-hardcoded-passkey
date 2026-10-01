"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function SignIn() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const signIn = async () => {
    const { error } = await authClient.signIn.hardcodedPasskey();
    if (error) setError(error.message);
    else router.refresh();
  };
  return (
    <>
      <button onClick={() => void signIn()}>Sign in with passkey</button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function SignOut() {
  const router = useRouter();
  const signOut = async () => {
    await authClient.signOut();
    router.refresh();
  };
  return <button onClick={() => void signOut()}>Sign out</button>;
}
