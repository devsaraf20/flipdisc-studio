# Flip-Disc Studio: send a TOP to the flip-disc simulator (or bridge) from TouchDesigner.
#
# Paste into an Execute DAT (turn on "Frame End"). Needs:
#   - a TOP named 'flipdisc_in' at the panel's resolution, e.g. 28 x 14
#     (your visuals → Resolution TOP set to Custom 28x14 → Null TOP 'flipdisc_in')
#   - an OSC Out DAT named 'oscout1': Network Address 127.0.0.1, Port 9000
#
# The bridge expects on/off values, so this script thresholds the image. For
# photographic content, add a dither in TouchDesigner before 'flipdisc_in'.

THRESHOLD = 0.5     # 0..1 brightness that counts as "on"
SEND_EVERY = 4      # send every Nth frame: 60 fps / 4 = 15 fps, like a real panel

def onFrameEnd(frame):
    if frame % SEND_EVERY:
        return
    top = op('flipdisc_in')
    arr = top.numpyArray(delayed=True)   # (height, width, 4) floats, bottom row first
    if arr is None:
        return
    h, w = arr.shape[0], arr.shape[1]
    lum = arr[::-1, :, 0] * 0.2126 + arr[::-1, :, 1] * 0.7152 + arr[::-1, :, 2] * 0.0722
    bits = ''.join('1' if v >= THRESHOLD else '0' for v in lum.flatten())
    # /flipdisc/frame width height "0101..." (row by row, top-left first)
    op('oscout1').sendOSC('/flipdisc/frame', [w, h, bits])
    return
