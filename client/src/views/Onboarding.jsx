import { useState } from "react";
import { ArrowRight, Map, FilePlus } from "lucide-react";
import { Button, Input, Card } from "../ui.jsx";
import { Logo } from "./Logo.jsx";
import Mascot, { SPECIES_LIST } from "./Mascot.jsx";
import CoachBubble from "./CoachBubble.jsx";
import { uid } from "../lib/uid.js";

// a small starter path so the app isn't an empty room on first open (fully editable)
function exampleSeed(state) {
  const rmId = uid("rm");
  state.roadmaps.push({
    id: rmId,
    title: "Bare-metal embedded",
    sourceUrl: null,
    color: "#4E8640",
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
  const [step, setStep] = useState(0); // 0 = name, 1 = choose your companion
  const [mascot, setMascot] = useState("shiba");

  const begin = (withExample) =>
    save((s) => {
      s.profile.name = name.trim();
      s.profile.mascot = mascot;
      s.profile.onboarded = true;
      if (withExample) {
        exampleSeed(s);
      }
    });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <Logo className="h-16 w-16" />
          <h1 className="mt-3 text-2xl font-bold text-slate-800 dark:text-slate-100">Michi</h1>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            道 michi — the path.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Roadmaps, projects, and loose tasks, turned into a few doable steps a day. You walk it;
            Michi keeps the map.
          </p>
        </div>

        {step === 0 ? (
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
            <Button onClick={() => setStep(1)} className="w-full">
              Continue <ArrowRight size={16} />
            </Button>
          </Card>
        ) : (
          <Card className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Choose your companion
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  They&apos;ll walk the path with you — you can always swap in Settings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep(0)}
                className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ← back
              </button>
            </div>
            {/* the chosen one steps forward and says hello — live-updates per tap.
                burst rides the species id so each pick replays the happy hop. */}
            <CoachBubble species={mascot} mood="happy" burst={mascot} size={56} side="left">
              I&apos;m your michi. You walk; I keep the map.
            </CoachBubble>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Companion">
              {SPECIES_LIST.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mascot === id}
                  onClick={() => setMascot(id)}
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-xs font-medium transition ${
                    mascot === id
                      ? "bg-trail-50 text-trail-700 ring-2 ring-trail-500 dark:bg-slate-800 dark:text-trail-300"
                      : "text-slate-500 ring-1 ring-slate-200 hover:ring-trail-300 dark:ring-slate-700"
                  }`}
                >
                  <Mascot species={id} mood="idle" size={64} />
                  {label}
                </button>
              ))}
            </div>

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
        )}

        <p className="text-center text-xs text-slate-400">
          Runs entirely on your mini PC. Your data never leaves your devices.
        </p>
      </div>
    </div>
  );
}
