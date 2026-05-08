import { NextResponse } from "next/server";
import { withSupervisorAuth } from "@/lib/supervisor/http";
import { handleSupervisorMcp } from "@/lib/supervisor/mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withSupervisorAuth(request, async (services) => {
    const payload = await request.json().catch(() => null);
    if (!payload) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    if (Array.isArray(payload)) {
      const responses = (
        await Promise.all(payload.map((item) => handleSupervisorMcp(item, services)))
      ).filter((item) => item !== null);
      if (responses.length === 0) return new NextResponse(null, { status: 204 });
      return NextResponse.json(responses);
    }

    const response = await handleSupervisorMcp(payload, services);
    if (!response) return new NextResponse(null, { status: 204 });
    return NextResponse.json(response);
  });
}

export async function GET(request: Request) {
  return withSupervisorAuth(request, async () =>
    NextResponse.json({
      name: "ao-supervisor",
      transport: "streamable-http",
      endpoint: "/api/supervisor/mcp",
    }),
  );
}
