import { useState } from "react";
import { ArrowRight, Map, FilePlus } from "lucide-react";
import { Button, Input, Card } from "../ui.jsx";
import { Logo } from "./Logo.jsx";
import { uid } from "../lib/uid.js";

// a small starter path so the app isn't an empty room on first open (fully editable)
function exampleSeed(state) {
  const rmId = uid("rm");
  state.roadmaps.push({
    id: rmId,
    title: "Bare-metal embedded",
    sourceUrl: null,
    color: "#10B981",
    archived: false,
    position: 0,
  });
  const milestones = [
    {
      title: "Fundamentals",
      steps: ["Blink an LED (GPIO)", "UART hello world", "Timers & interrupts"],
    },
    { title: "Peripherals", steps: ["SPI", "I2C", "ADC sampling"] },
    { title: "Toward an RTOS", steps: ["Tasks & a scheduler", "Queues & semaphores"] },
  ];
  milestones.forEach((m, mi) => {
    const msId = uid("ms");
    state.milestones.push({ id: msId, roadmapId: rmId, title: m.title, position: mi });
    m.steps.forEach((title, si) => {
      state.steps.push({ id: uid("step"), milestoneId: msId, title, status: "todo", position: si });
    });
  });
}

export default function Onboarding({ save, busy }) {
  const [name, setName] = useState("");

  const begin = (withExample) =>
    save((s) => {
      s.profile.name = name.trim();
      s.profile.onboarded = true;
      if (withExample) {
        exampleSeed(s);
      }
    });

  return (
    <div className="trail-gradient flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <Logo className="h-16 w-16" />
          <h1 className="mt-3 text-2xl font-bold text-slate-800 dark:text-slate-100">Michi</h1>
          <p className="text-sm text-slate-500">
            Your learning paths, roadmaps, and projects — turned into what to do today.
          </p>
        </div>

        <Card className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
              What should I call you?
            </span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional"
            />
          </label>

          <Button onClick={() => begin(true)} disabled={busy} className="w-full">
            <Map size={16} /> Start with an example roadmap <ArrowRight size={16} />
          </Button>
          <button
            onClick={() => begin(false)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <FilePlus size={15} /> Start from scratch
          </button>
        </Card>

        <p className="text-center text-xs text-slate-400">
          Runs entirely on your mini PC. Your data never leaves your devices.
        </p>
      </div>
    </div>
  );
}
