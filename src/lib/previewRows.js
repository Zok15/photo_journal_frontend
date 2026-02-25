export function buildPreviewRowsWithClampedHeights(
  photos,
  containerWidth,
  aspectRatioById = {},
  options = {},
) {
  const previewGap = Number.isFinite(options.gap) ? options.gap : 8
  const minPerRow = Number.isFinite(options.minPerRow) ? options.minPerRow : 2
  const maxPerRow = Number.isFinite(options.maxPerRow) ? options.maxPerRow : 5
  const targetRowHeight = Number.isFinite(options.targetRowHeight) ? options.targetRowHeight : 170
  const minRowHeight = Number.isFinite(options.minRowHeight) ? options.minRowHeight : 96
  const maxRowHeight = Number.isFinite(options.maxRowHeight) ? options.maxRowHeight : 260
  const minPreviewRatio = Number.isFinite(options.minPreviewRatio) ? options.minPreviewRatio : 0.72
  const maxPreviewRatio = Number.isFinite(options.maxPreviewRatio) ? options.maxPreviewRatio : 2.4
  const minTileWidth = Number.isFinite(options.minTileWidth) ? options.minTileWidth : 140
  const maxTileWidth = Number.isFinite(options.maxTileWidth) ? options.maxTileWidth : 420
  const singleMinHeight = Number.isFinite(options.singleMinHeight) ? options.singleMinHeight : 120
  const singleMaxHeight = Number.isFinite(options.singleMaxHeight) ? options.singleMaxHeight : 240
  const fallbackHeight = Number.isFinite(options.fallbackHeight) ? options.fallbackHeight : 160

  const width = Math.max(1, Number(containerWidth) || 1)
  const items = (Array.isArray(photos) ? photos : []).map((photo) => {
    const rawRatio = Number(aspectRatioById?.[photo?.id]) || 1
    return {
      photo,
      ratio: Math.min(maxPreviewRatio, Math.max(minPreviewRatio, rawRatio)),
    }
  })

  if (!items.length) {
    return { rows: [] }
  }

  if (items.length === 1) {
    const ratio = items[0].ratio || 1
    const height = Math.max(singleMinHeight, Math.min(singleMaxHeight, width / ratio))
    return {
      rows: [{ gap: 0, height, tiles: [{ photo: items[0].photo, width: ratio * height }] }],
    }
  }

  const minRows = Math.ceil(items.length / maxPerRow)
  const maxRows = Math.floor(items.length / minPerRow)
  let best = null

  for (let rowsCount = minRows; rowsCount <= maxRows; rowsCount += 1) {
    const base = Math.floor(items.length / rowsCount)
    const extra = items.length % rowsCount
    const counts = Array.from({ length: rowsCount }, (_, index) => base + (index < extra ? 1 : 0))

    if (counts.some((count) => count < minPerRow || count > maxPerRow)) {
      continue
    }

    const ratiosByRow = []
    let cursor = 0
    for (const count of counts) {
      const chunk = items.slice(cursor, cursor + count)
      cursor += count
      ratiosByRow.push(chunk.reduce((sum, item) => sum + item.ratio, 0))
    }

    const rowHeights = ratiosByRow.map((ratioSum, index) => {
      const rowWidth = width - previewGap * (counts[index] - 1)
      return rowWidth / ratioSum
    })

    const rows = []
    cursor = 0
    let emptySpace = 0
    let outOfRangePenalty = 0
    let targetDeviation = 0

    for (let rowIndex = 0; rowIndex < counts.length; rowIndex += 1) {
      const count = counts[rowIndex]
      const chunk = items.slice(cursor, cursor + count)
      cursor += count

      const rowHeight = rowHeights[rowIndex]
      const widths = chunk.map((item) => item.ratio * rowHeight)
      const minWidthInRow = widths.length ? Math.min(...widths) : 0
      const maxWidthInRow = widths.length ? Math.max(...widths) : 0
      const rowTotalWidth = widths.reduce((sum, tileWidth) => sum + tileWidth, 0)
      const used = rowTotalWidth + previewGap * (count - 1)
      emptySpace += Math.abs(width - used)
      targetDeviation += Math.abs(targetRowHeight - rowHeight)

      if (rowHeight < minRowHeight) {
        outOfRangePenalty += Math.abs(minRowHeight - rowHeight) * 6
      } else if (rowHeight > maxRowHeight) {
        outOfRangePenalty += Math.abs(rowHeight - maxRowHeight) * 6
      }
      if (minWidthInRow < minTileWidth) {
        outOfRangePenalty += (minTileWidth - minWidthInRow) * 12
      }
      if (maxWidthInRow > maxTileWidth) {
        outOfRangePenalty += (maxWidthInRow - maxTileWidth) * 10
      }

      rows.push({
        gap: previewGap,
        height: rowHeight,
        tiles: chunk.map((item) => ({
          photo: item.photo,
          width: item.ratio * rowHeight,
        })),
      })
    }

    const score = emptySpace + targetDeviation * 1.4 + outOfRangePenalty
    if (!best || score < best.score) {
      best = { score, rows }
    }
  }

  if (!best) {
    return {
      rows: [{
        gap: previewGap,
        height: fallbackHeight,
        tiles: items.map((item) => ({ photo: item.photo, width: item.ratio * fallbackHeight })),
      }],
    }
  }

  return { rows: best.rows }
}

export function buildPreviewRowsWithDynamicGrid(
  photos,
  containerWidth,
  aspectRatioById = {},
  options = {},
) {
  const previewGap = Number.isFinite(options.gap) ? options.gap : 10
  const minPerRow = Number.isFinite(options.minPerRow) ? options.minPerRow : 3
  const maxPerRow = Number.isFinite(options.maxPerRow) ? options.maxPerRow : 6
  const preferredPerRow = Number.isFinite(options.preferredPerRow) ? options.preferredPerRow : 4
  const mobileMinPerRow = Number.isFinite(options.mobileMinPerRow) ? options.mobileMinPerRow : 1
  const mobileMaxPerRow = Number.isFinite(options.mobileMaxPerRow) ? options.mobileMaxPerRow : 2
  const minTileWidthMobile = Number.isFinite(options.minTileWidthMobile) ? options.minTileWidthMobile : 150
  const minTileWidthDesktop = Number.isFinite(options.minTileWidthDesktop) ? options.minTileWidthDesktop : 180
  const maxTileWidthMobile = Number.isFinite(options.maxTileWidthMobile) ? options.maxTileWidthMobile : 320
  const maxTileWidthDesktop = Number.isFinite(options.maxTileWidthDesktop) ? options.maxTileWidthDesktop : 420
  const mobileBreakPoint = Number.isFinite(options.mobileBreakPoint) ? options.mobileBreakPoint : 760
  const targetRowHeight = Number.isFinite(options.targetRowHeight) ? options.targetRowHeight : 300
  const minRowHeight = Number.isFinite(options.minRowHeight) ? options.minRowHeight : 210
  const maxRowHeight = Number.isFinite(options.maxRowHeight) ? options.maxRowHeight : 420
  const singleMaxHeight = Number.isFinite(options.singleMaxHeight) ? options.singleMaxHeight : 300
  const stretchLastRow = options.stretchLastRow !== false

  const width = Math.max(1, Number(containerWidth) || 1)
  const isMobile = width <= mobileBreakPoint
  const minTileWidth = isMobile ? minTileWidthMobile : minTileWidthDesktop
  const maxTileWidth = isMobile ? maxTileWidthMobile : maxTileWidthDesktop
  const effectiveMinPerRow = isMobile ? mobileMinPerRow : minPerRow
  const effectiveMaxPerRow = isMobile ? mobileMaxPerRow : maxPerRow

  const maxByMinTileWidth = Math.max(1, Math.floor((width + previewGap) / (minTileWidth + previewGap)))
  const minByMaxTileWidth = Math.max(1, Math.ceil((width + previewGap) / (maxTileWidth + previewGap)))
  const allowedMinPerRow = Math.max(effectiveMinPerRow, minByMaxTileWidth)
  const allowedMaxPerRow = Math.max(1, Math.min(effectiveMaxPerRow, maxByMinTileWidth))
  const clampedMinPerRow = Math.min(allowedMinPerRow, allowedMaxPerRow)
  const clampedMaxPerRow = Math.max(allowedMinPerRow, allowedMaxPerRow)
  const targetPerRow = Math.max(clampedMinPerRow, Math.min(clampedMaxPerRow, preferredPerRow))

  const items = (Array.isArray(photos) ? photos : []).map((photo) => ({
    photo,
    ratio: Number(aspectRatioById?.[photo?.id]) || 1,
  }))

  if (!items.length) {
    return { rows: [] }
  }

  if (items.length === 1) {
    const ratio = items[0].ratio || 1
    const constrainedWidth = Math.min(width, maxTileWidth)
    const height = Math.min(singleMaxHeight, constrainedWidth / ratio)
    return {
      rows: [{ gap: 0, height, tiles: [{ photo: items[0].photo, width: ratio * height }] }],
    }
  }

  const rows = []
  const fullRowHeights = []
  let cursor = 0

  while (cursor + targetPerRow <= items.length) {
    const chunk = items.slice(cursor, cursor + targetPerRow)
    cursor += targetPerRow
    const ratioSum = chunk.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
    const rowWidth = width - previewGap * (chunk.length - 1)
    const rowHeight = rowWidth / ratioSum

    fullRowHeights.push(rowHeight)
    rows.push({
      gap: previewGap,
      height: rowHeight,
      tiles: chunk.map((item) => ({
        photo: item.photo,
        width: item.ratio * rowHeight,
      })),
    })
  }

  const tail = cursor < items.length ? items.slice(cursor) : []
  if (tail.length > 0) {
    const ratioSum = tail.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
    const fittedTailHeight = (width - previewGap * (tail.length - 1)) / ratioSum
    const averageHeight = fullRowHeights.length
      ? fullRowHeights.reduce((sum, value) => sum + value, 0) / fullRowHeights.length
      : targetRowHeight

    const desiredTailHeight = stretchLastRow
      ? fittedTailHeight
      : Math.min(fittedTailHeight, averageHeight)
    const tailHeight = Math.max(minRowHeight, Math.min(maxRowHeight, desiredTailHeight))

    rows.push({
      gap: previewGap,
      height: tailHeight,
      tiles: tail.map((item) => ({
        photo: item.photo,
        width: item.ratio * tailHeight,
      })),
    })
  }

  return { rows }
}
