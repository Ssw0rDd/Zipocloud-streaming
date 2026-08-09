import type { Metadata } from "next";
import { CinemaRoomClient } from "./CinemaRoomClient";

export const metadata: Metadata = {
  title: "Cinema ZiPo",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CinemaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CinemaRoomClient token={token} />;
}

