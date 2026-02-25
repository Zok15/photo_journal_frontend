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
      const clampedHeight = Math.max(minRowHeight, Math.min(maxRowHeight, rowHeight))
      const widths = chunk.map((item) => item.ratio * clampedHeight)
      const rowTotalWidth = widths.reduce((sum, tileWidth) => sum + tileWidth, 0)
      const used = rowTotalWidth + previewGap * (count - 1)
      emptySpace += Math.abs(width - used)
      targetDeviation += Math.abs(targetRowHeight - clampedHeight)

      if (rowHeight !== clampedHeight) {
        outOfRangePenalty += Math.abs(rowHeight - clampedHeight) * 6
      }

      rows.push({
        gap: previewGap,
        height: clampedHeight,
        tiles: chunk.map((item) => ({
          photo: item.photo,
          width: item.ratio * clampedHeight,
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
  const minPerRow = Number.isFinite(options.minPerRow) ? options.minPerRow : 2
  const maxPerRow = Number.isFinite(options.maxPerRow) ? options.maxPerRow : 5
  const minTileWidthMobile = Number.isFinite(options.minTileWidthMobile) ? options.minTileWidthMobile : 150
  const minTileWidthDesktop = Number.isFinite(options.minTileWidthDesktop) ? options.minTileWidthDesktop : 180
  const mobileBreakPoint = Number.isFinite(options.mobileBreakPoint) ? options.mobileBreakPoint : 760
  const targetRowHeight = Number.isFinite(options.targetRowHeight) ? options.targetRowHeight : 300
  const minRowHeight = Number.isFinite(options.minRowHeight) ? options.minRowHeight : 210
  const maxRowHeight = Number.isFinite(options.maxRowHeight) ? options.maxRowHeight : 420
  const singleMaxHeight = Number.isFinite(options.singleMaxHeight) ? options.singleMaxHeight : 300
  const minPreviewRatio = Number.isFinite(options.minPreviewRatio) ? options.minPreviewRatio : 0.72
  const maxPreviewRatio = Number.isFinite(options.maxPreviewRatio) ? options.maxPreviewRatio : 2.4

  const width = Math.max(1, Number(containerWidth) || 1)
  const minTileWidth = width <= mobileBreakPoint ? minTileWidthMobile : minTileWidthDesktop
  const dynamicMaxPerRow = Math.max(
    minPerRow,
    Math.min(
      maxPerRow,
      Math.floor((width + previewGap) / (minTileWidth + previewGap)),
    ),
  )
  const items = (Array.isArray(photos) ? photos : []).map((photo) => ({
    photo,
    ratio: Math.min(maxPreviewRatio, Math.max(minPreviewRatio, Number(aspectRatioById?.[photo?.id]) || 1)),
  }))

  if (!items.length) {
    return { rows: [] }
  }

  if (items.length === 1) {
    const ratio = items[0].ratio || 1
    const height = Math.min(singleMaxHeight, width / ratio)
    return {
      rows: [{ gap: 0, height, tiles: [{ photo: items[0].photo, width: ratio * height }] }],
    }
  }

  const minRows = Math.ceil(items.length / dynamicMaxPerRow)
  const maxRows = Math.floor(items.length / minPerRow)
  let best = null

  for (let rowsCount = minRows; rowsCount <= maxRows; rowsCount += 1) {
    const base = Math.floor(items.length / rowsCount)
    const extra = items.length % rowsCount
    const counts = Array.from({ length: rowsCount }, (_, index) => base + (index < extra ? 1 : 0))

    if (counts.some((count) => count < minPerRow || count > dynamicMaxPerRow)) {
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
      const clampedHeight = Math.max(minRowHeight, Math.min(maxRowHeight, rowHeight))
      const widths = chunk.map((item) => item.ratio * clampedHeight)
      const minWidthInRow = widths.length ? Math.min(...widths) : 0
      const rowTotalWidth = widths.reduce((sum, tileWidth) => sum + tileWidth, 0)
      const used = rowTotalWidth + previewGap * (count - 1)
      emptySpace += Math.abs(width - used)
      targetDeviation += Math.abs(targetRowHeight - clampedHeight)

      if (rowHeight !== clampedHeight) {
        outOfRangePenalty += Math.abs(rowHeight - clampedHeight) * 6
      }
      if (minWidthInRow < minTileWidth) {
        // Keep controls in one line on narrow portrait previews.
        outOfRangePenalty += (minTileWidth - minWidthInRow) * 1200
      }

      rows.push({
        gap: previewGap,
        height: clampedHeight,
        tiles: chunk.map((item) => ({
          photo: item.photo,
          width: item.ratio * clampedHeight,
        })),
      })
    }

    const score = emptySpace + targetDeviation * 1.4 + outOfRangePenalty
    if (!best || score < best.score) {
      best = { score, rows }
    }
  }

  if (!best) {
    const rows = []
    let cursor = 0

    while (cursor < items.length) {
      const remaining = items.length - cursor
      let count = Math.min(dynamicMaxPerRow, remaining)

      if (remaining === count + 1 && count > minPerRow) {
        count -= 1
      }

      // Reduce cards in row until the narrowest tile can satisfy min width.
      while (count > minPerRow) {
        const candidate = items.slice(cursor, cursor + count)
        const ratioSum = candidate.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
        const minRatio = candidate.reduce((min, item) => Math.min(min, item.ratio), Number.POSITIVE_INFINITY)
        const rowWidth = width - previewGap * (candidate.length - 1)
        const rowHeight = Math.min(maxRowHeight, rowWidth / ratioSum)
        if (minRatio * rowHeight >= minTileWidth) {
          break
        }
        count -= 1
      }

      const chunk = items.slice(cursor, cursor + count)
      cursor += count
      const ratioSum = chunk.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
      const rowWidth = width - previewGap * (chunk.length - 1)
      const rowHeight = Math.min(maxRowHeight, rowWidth / ratioSum)

      rows.push({
        gap: previewGap,
        height: rowHeight,
        tiles: chunk.map((item) => ({
          photo: item.photo,
          width: item.ratio * rowHeight,
        })),
      })
    }

    return { rows }
  }

  return { rows: best.rows }
}
