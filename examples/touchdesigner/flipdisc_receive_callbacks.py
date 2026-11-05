# Flip-Disc Studio: receive the studio's output in TouchDesigner.
#
# Start the bridge with rows output (the default):  npm run bridge
# It sends /flipdisc/row/<y> (one value per disc) and /flipdisc/commit to 127.0.0.1:9001.
#
# 1. Add an OSC In DAT: Network Port 9001. Set its Callbacks DAT to this DAT.
# 2. Add a Table DAT named 'flipdisc_grid'.
# 3. Optional: Script TOP named 'flipdisc_view' whose callbacks call show_grid() below,
#    or simply DAT to CHOP / CHOP to TOP from the table.

def onReceiveOSC(dat, rowIndex, message, byteData, timeStamp, address, args, peer):
    if not address.startswith('/flipdisc/row/'):
        return
    y = int(address.rsplit('/', 1)[1])
    grid = op('flipdisc_grid')
    if grid.numRows <= y:
        grid.setSize(y + 1, max(grid.numCols, len(args)))
    if grid.numCols < len(args):
        grid.setSize(grid.numRows, len(args))
    for x, v in enumerate(args):
        grid[y, x] = int(v)
    return


# Script TOP helper (paste into a Script TOP's callbacks DAT, onCook):
#
# import numpy as np
# def onCook(scriptOp):
#     g = op('flipdisc_grid')
#     a = np.array([[float(g[r, c]) for c in range(g.numCols)] for r in range(g.numRows)], dtype=np.float32)
#     img = np.dstack([a, a * 0.8, a * 0.2, np.ones_like(a)])[::-1]  # yellow discs, flip to TD's bottom-up rows
#     scriptOp.copyNumpyArray(np.ascontiguousarray(img))
