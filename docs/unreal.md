# Unreal Engine → Flip-Disc Studio

Render a camera view at the panel's resolution, read the pixels and send them
over OSC to the bridge. The studio shows them on the simulated panel.

```
SceneCapture2D ─▶ Render Target (28×14) ─▶ read pixels ─▶ OSC Client ─▶ bridge :9000 ─▶ Studio
```

Node and function names below are from Unreal Engine 5. They may differ a
little between engine versions; search the node menu for the key word.

## 0. Start the bridge and the studio

```bash
npm run bridge
```

In the studio: **Input** tab → **Connect** → **Show OSC input on the display**.

## 1. Enable the OSC plugin

*Edit → Plugins*, search **OSC** (by Epic Games), enable it, restart the editor.

## 2. Make a tiny render target

1. Content Browser → *Add → Textures → Render Target*. Name it `RT_FlipDisc`.
2. Open it: *Size X* **28**, *Size Y* **14** (your panel size), *Render Target
   Format* **RTF RGBA8**. Small is the point: one texel = one disc.
3. Place a **Scene Capture 2D** actor (or add a *SceneCaptureComponent2D* to a
   camera Blueprint). Set *Texture Target* = `RT_FlipDisc`, *Capture Source* =
   *Final Color (LDR) in RGB*. Turn on *Capture Every Frame*, or call
   *Capture Scene* yourself before reading.

Tip: high-contrast scenes read best. Try an unlit material, strong rim light or
a post-process that pushes to black and white.

## 3. Blueprint: send the grid

In an Actor Blueprint (for example, the one holding the Scene Capture):

**Event BeginPlay**
1. `Create OSC Client` — *Send IP Address* `127.0.0.1`, *Port* `9000`,
   *Name* `FlipDisc`. Promote the return value to a variable `OscClient`.
2. `Set Timer by Event` — *Time* `0.066` (≈15 fps), *Looping* ✔, bound to a
   custom event `SendFrame`.

**Custom Event SendFrame**
1. Build the bits as a string. For a 28×14 target that is 392 reads:
   - `For Loop` Y 0 → 13, nested `For Loop` X 0 → 27
   - `Read Render Target Pixel` (Kismet Rendering Library) with `RT_FlipDisc`, X, Y
     → returns a `Color`. Compute brightness `(R + G + B) / 3 > 127`
   - `Append` `"1"` or `"0"` to a local string `Bits`
2. Create a local variable `Msg` of type *OSC Message*. Call `Clear Message` on it
   (so it starts empty each time).
3. `Convert String to OSC Address` with `"/flipdisc/frame"` → `Set OSC Message Address` on `Msg`
4. `Add Int32` 28 → `Add Int32` 14 → `Add String` `Bits`
5. `OscClient → Send OSC Message` with `Msg`

`Read Render Target Pixel` flushes the GPU on every call. 392 calls at 15 fps
is fine for prototyping; for big panels use the C++ version below, which reads
everything in one go.

## 4. C++ (faster, any size)

```cpp
// FlipDiscSender.h  (add "OSC" to PublicDependencyModuleNames in your .Build.cs)
#include "OSCManager.h"
#include "OSCClient.h"
#include "Engine/TextureRenderTarget2D.h"

UPROPERTY(EditAnywhere) UTextureRenderTarget2D* RenderTarget;
UPROPERTY() UOSCClient* Client;

void AFlipDiscSender::BeginPlay()
{
    Super::BeginPlay();
    Client = UOSCManager::CreateOSCClient(TEXT("127.0.0.1"), 9000, TEXT("FlipDisc"), this);
}

void AFlipDiscSender::SendFrame()
{
    FTextureRenderTargetResource* Res = RenderTarget->GameThread_GetRenderTargetResource();
    TArray<FColor> Pixels;
    if (!Res || !Res->ReadPixels(Pixels)) return;

    const int32 W = RenderTarget->SizeX, H = RenderTarget->SizeY;
    FString Bits;
    Bits.Reserve(W * H);
    for (int32 i = 0; i < W * H; ++i)           // ReadPixels is row by row from the top-left
    {
        const FColor& C = Pixels[i];
        Bits.AppendChar((C.R + C.G + C.B) / 3 > 127 ? TEXT('1') : TEXT('0'));
    }

    FOSCMessage Msg;
    UOSCManager::SetOSCMessageAddress(Msg, UOSCManager::ConvertStringToOSCAddress(TEXT("/flipdisc/frame")));
    UOSCManager::AddInt32(Msg, W);
    UOSCManager::AddInt32(Msg, H);
    UOSCManager::AddString(Msg, Bits);
    Client->SendOSCMessage(Msg);
}
```

Call `SendFrame()` from a 15 fps timer.

## Other message shapes

The bridge also accepts `/flipdisc/frame W H <blob>` (packed bits, MSB first,
row by row) and `/flipdisc/row Y v0 v1 …` per row. See the README for the
full list.

## Troubleshooting

- **Nothing arrives**: check the bridge log for `OSC packets in`. Make sure the
  OSC Client port is 9000 and the bridge is running on the same machine (or use
  that machine's IP).
- **All black or all white**: the threshold (127) doesn't suit your scene;
  adjust the lighting, or add contrast with a post-process material.
- **Image mirrored**: flip the Scene Capture's transform or swap the X loop.
