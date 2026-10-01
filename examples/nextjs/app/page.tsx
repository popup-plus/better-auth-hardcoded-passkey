import { headers } from "next/headers";
import { auth } from "../lib/auth";
import { SignIn, SignOut } from "./buttons";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <SignIn />;
  return (
    <>
      <p>Signed in as {session.user.email}</p>
      <SignOut />
    </>
  );
}
