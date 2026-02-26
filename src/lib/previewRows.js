export function buildPreviewRowsWithClampedHeights(
  photos,
  containerWidth,
  aspectRatioById = {},
  options = {},
) {
  const previewGap = Number.isFinite(options.gap) ? options.gap : 8
  const minPerRow = Number.isFinite(options.minPerRow) ? options.minPerRow : 2
  const maxPerRow = Number.isFinite(options.maxPerRow) ? options.maxPerRow : 5
  const mobileMinPerRow = Number.isFinite(options.mobileMinPerRow) ? options.mobileMinPerRow : minPerRow
  const mobileMaxPerRow = Number.isFinite(options.mobileMaxPerRow) ? options.mobileMaxPerRow : maxPerRow
  const mobileBreakPoint = Number.isFinite(options.mobileBreakPoint) ? options.mobileBreakPoint : 760
  const strictRatioOnMobile = options.strictRatioOnMobile === true
  const forceMobileLayout = typeof options.forceMobileLayout === 'boolean'
    ? options.forceMobileLayout
    : null
  const targetRowHeight = Number.isFinite(options.targetRowHeight) ? options.targetRowHeight : 170
  const minRowHeight = Number.isFinite(options.minRowHeight) ? options.minRowHeight : 96
  const maxRowHeight = Number.isFinite(options.maxRowHeight) ? options.maxRowHeight : 260
  const minPreviewRatio = Number.isFinite(options.minPreviewRatio) ? options.minPreviewRatio : 0.72
  const maxPreviewRatio = Number.isFinite(options.maxPreviewRatio) ? options.maxPreviewRatio : 2.4
  const singleMinHeight = Number.isFinite(options.singleMinHeight) ? options.singleMinHeight : 120
  const singleMaxHeight = Number.isFinite(options.singleMaxHeight) ? options.singleMaxHeight : 240
  const fallbackHeight = Number.isFinite(options.fallbackHeight) ? options.fallbackHeight : 160

  const width = Math.max(1, Number(containerWidth) || 1)
  const useMobileLayout = forceMobileLayout === null ? width <= mobileBreakPoint : forceMobileLayout
  const effectiveMinPerRow = useMobileLayout ? mobileMinPerRow : minPerRow
  const effectiveMaxPerRow = useMobileLayout ? mobileMaxPerRow : maxPerRow
  const items = (Array.isArray(photos) ? photos : []).map((photo) => {
    const rawRatio = Number(aspectRatioById?.[photo?.id]) || 1
    const ratio = strictRatioOnMobile && useMobileLayout
      ? (rawRatio > 0 ? rawRatio : 1)
      : Math.min(maxPreviewRatio, Math.max(minPreviewRatio, rawRatio))
    return {
      photo,
      ratio,
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

  const minRows = Math.ceil(items.length / effectiveMaxPerRow)
  const maxRows = Math.floor(items.length / effectiveMinPerRow)
  let best = null

  for (let rowsCount = minRows; rowsCount <= maxRows; rowsCount += 1) {
    const base = Math.floor(items.length / rowsCount)
    const extra = items.length % rowsCount
    const counts = Array.from({ length: rowsCount }, (_, index) => base + (index < extra ? 1 : 0))

    if (counts.some((count) => count < effectiveMinPerRow || count > effectiveMaxPerRow)) {
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

export function buildPreviewRowsWithHeroPattern(
  photos,
  containerWidth,
  aspectRatioById = {},
  options = {},
) {
  const width = Math.max(1, Number(containerWidth) || 1)
  const targetTotalHeight = Number.isFinite(options.targetTotalHeight) ? options.targetTotalHeight : 280
  const minGap = Number.isFinite(options.minGap) ? options.minGap : 2
  const maxGap = Number.isFinite(options.maxGap) ? options.maxGap : 20
  const targetGap = Number.isFinite(options.targetGap) ? options.targetGap : 8
  const minRowHeight = Number.isFinite(options.minRowHeight) ? options.minRowHeight : 70
  const maxRowHeight = Number.isFinite(options.maxRowHeight) ? options.maxRowHeight : 320
  const minPerRow = Number.isFinite(options.minPerRow) ? options.minPerRow : 2
  const maxPerRow = Number.isFinite(options.maxPerRow) ? options.maxPerRow : 7
  const minRowsOption = Number.isFinite(options.minRows) ? Math.max(1, Number(options.minRows)) : null
  const maxRowsOption = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : null
  const fallbackGap = Number.isFinite(options.fallbackGap) ? options.fallbackGap : 8
  const fallbackMaxTiles = Number.isFinite(options.fallbackMaxTiles) ? options.fallbackMaxTiles : 6
  const fallbackMinRows = Number.isFinite(options.fallbackMinRows) ? options.fallbackMinRows : 1
  const minCountOption = Number.isFinite(options.minCount) ? options.minCount : 4
  const maxCountOption = Number.isFinite(options.maxCount) ? options.maxCount : 18
  const ratioFallback = Number.isFinite(options.ratioFallback) ? options.ratioFallback : 1
  const minRatio = Number.isFinite(options.minRatio) ? options.minRatio : null
  const maxRatio = Number.isFinite(options.maxRatio) ? options.maxRatio : null
  const rowHeightUniformityWeight = Number.isFinite(options.rowHeightUniformityWeight)
    ? Number(options.rowHeightUniformityWeight)
    : 1
  const rebalanceRows = options.rebalanceRows === true

  const items = (Array.isArray(photos) ? photos : [])
    .map((photo) => ({
      photo,
      ratio: (() => {
        const raw = Number(aspectRatioById?.[photo?.id]) || ratioFallback
        const withMin = minRatio !== null ? Math.max(minRatio, raw) : raw
        return maxRatio !== null ? Math.min(maxRatio, withMin) : withMin
      })(),
    }))
    .filter((item) => item.ratio > 0)

  if (!items.length) {
    return { rows: [] }
  }

  const maxCount = Math.max(1, Math.min(items.length, maxCountOption))
  const minCount = Math.max(1, Math.min(maxCount, minCountOption))
  let best = null

  function buildRowsForCounts(chunk, rowCounts) {
    if (!rebalanceRows) {
      const rows = []
      let cursor = 0
      for (const count of rowCounts) {
        const rowItems = chunk.slice(cursor, cursor + count)
        cursor += count
        const ratioSum = rowItems.reduce((sum, item) => sum + item.ratio, 0)
        rows.push({
          items: rowItems,
          count,
          ratioSum: ratioSum || 0.0001,
        })
      }
      return rows
    }

    const rows = []
    let cursor = 0
    for (const count of rowCounts) {
      const rowItems = chunk.slice(cursor, cursor + count)
      cursor += count
      rows.push({
        items: rowItems,
        count,
        ratioSum: rowItems.reduce((sum, item) => sum + item.ratio, 0) || 0.0001,
      })
    }

    const rowWidth = (count) => Math.max(1, width - targetGap * (count - 1))
    const loadSpread = (currentRows) => {
      if (!currentRows.length) {
        return 0
      }
      const loads = currentRows.map((row) => row.ratioSum / rowWidth(row.count))
      const mean = loads.reduce((sum, value) => sum + value, 0) / loads.length
      const variance = loads.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / loads.length
      return Math.sqrt(variance)
    }

    let baseline = loadSpread(rows)
    let improved = true
    let iterations = 0
    const maxIterations = Math.max(2, rows.length * 4)

    while (improved && iterations < maxIterations) {
      improved = false
      iterations += 1

      for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
        const left = rows[rowIndex]
        const right = rows[rowIndex + 1]
        if (!left.items.length || !right.items.length) {
          continue
        }

        const leftCandidate = left.items[left.items.length - 1]
        const rightCandidate = right.items[0]
        const nextLeftRatio = left.ratioSum - leftCandidate.ratio + rightCandidate.ratio
        const nextRightRatio = right.ratioSum - rightCandidate.ratio + leftCandidate.ratio

        const candidateRows = rows.map((row, index) => {
          if (index === rowIndex) {
            return { ...row, ratioSum: nextLeftRatio || 0.0001 }
          }
          if (index === rowIndex + 1) {
            return { ...row, ratioSum: nextRightRatio || 0.0001 }
          }
          return row
        })
        const candidateSpread = loadSpread(candidateRows)
        if (candidateSpread + 0.0001 >= baseline) {
          continue
        }

        left.items[left.items.length - 1] = rightCandidate
        right.items[0] = leftCandidate
        left.ratioSum = nextLeftRatio || 0.0001
        right.ratioSum = nextRightRatio || 0.0001
        baseline = candidateSpread
        improved = true
      }
    }

    return rows
  }

  function evaluateCandidate(chunk, rowCounts) {
    const rows = buildRowsForCounts(chunk, rowCounts)

    const denominator = (rows.length - 1) - rows.reduce((sum, row) => {
      return sum + ((row.count - 1) / row.ratioSum)
    }, 0)
    if (Math.abs(denominator) < 0.0001) {
      return
    }

    const widthsPart = rows.reduce((sum, row) => sum + (width / row.ratioSum), 0)
    const rawGap = (targetTotalHeight - widthsPart) / denominator
    if (!Number.isFinite(rawGap)) {
      return
    }
    const gap = Math.max(minGap, Math.min(maxGap, rawGap))

    const preparedRows = rows.map((row) => {
      const height = (width - gap * (row.count - 1)) / row.ratioSum
      return {
        gap,
        height,
        tiles: row.items.map((item) => ({
          photo: item.photo,
          width: item.ratio * height,
        })),
      }
    })

    const hasOutOfRangeHeight = preparedRows.some((row) => row.height < minRowHeight || row.height > maxRowHeight)
    if (hasOutOfRangeHeight) {
      return
    }

    const heights = preparedRows.map((row) => row.height)
    const mean = heights.reduce((sum, value) => sum + value, 0) / heights.length
    const variance = heights.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / heights.length
    const stdDev = Math.sqrt(variance)
    const clampPenalty = Math.abs(rawGap - gap) * 1.8
    const score = Math.abs(gap - targetGap) * 2.4
      + (stdDev * rowHeightUniformityWeight)
      + clampPenalty
      + (chunk.length * 0.05)

    if (!best || score < best.score) {
      best = { score, rows: preparedRows }
    }
  }

  for (let count = minCount; count <= maxCount; count += 1) {
    const chunk = items.slice(0, count)
    const minRowsByCount = Math.ceil(count / maxPerRow)
    const maxRowsByCount = Math.floor(count / minPerRow)
    const minRows = Math.max(minRowsByCount, minRowsOption ?? minRowsByCount)
    const maxRows = Math.min(maxRowsByCount, maxRowsOption ?? maxRowsByCount)
    if (minRows > maxRows) {
      continue
    }

    for (let rowsCount = minRows; rowsCount <= maxRows; rowsCount += 1) {
      const base = Math.floor(count / rowsCount)
      const extra = count % rowsCount
      const rowCounts = Array.from(
        { length: rowsCount },
        (_, index) => base + (index < extra ? 1 : 0),
      )
      if (rowCounts.some((rowCount) => rowCount < minPerRow || rowCount > maxPerRow)) {
        continue
      }
      evaluateCandidate(chunk, rowCounts)
    }

    for (let first = minPerRow; first <= count - minPerRow; first += 1) {
      const second = count - first
      if (first > maxPerRow || second > maxPerRow) {
        continue
      }
      evaluateCandidate(chunk, [first, second])
    }

    for (let first = minPerRow; first <= count - minPerRow * 2; first += 1) {
      for (let second = minPerRow; second <= count - first - minPerRow; second += 1) {
        const third = count - first - second
        if (first > maxPerRow || second > maxPerRow || third > maxPerRow || third < minPerRow) {
          continue
        }
        evaluateCandidate(chunk, [first, second, third])
      }
    }
  }

  if (best) {
    return { rows: best.rows }
  }

  const fallback = items.slice(0, Math.min(fallbackMaxTiles, items.length))
  if (!fallback.length) {
    return { rows: [] }
  }

  const fallbackRowsCount = Math.min(
    fallback.length,
    Math.max(fallbackMinRows, Math.ceil(fallback.length / maxPerRow)),
  )
  const fallbackBase = Math.floor(fallback.length / fallbackRowsCount)
  const fallbackExtra = fallback.length % fallbackRowsCount
  const rowChunks = []
  let cursor = 0
  for (let rowIndex = 0; rowIndex < fallbackRowsCount; rowIndex += 1) {
    const rowCount = fallbackBase + (rowIndex < fallbackExtra ? 1 : 0)
    if (rowCount <= 0) {
      continue
    }
    rowChunks.push(fallback.slice(cursor, cursor + rowCount))
    cursor += rowCount
  }

  const rows = rowChunks.map((rowItems) => {
    const ratioSum = rowItems.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
    const fittedHeight = (width - fallbackGap * (rowItems.length - 1)) / ratioSum
    const height = Math.min(maxRowHeight, Math.max(1, fittedHeight))
    return {
      gap: fallbackGap,
      height,
      tiles: rowItems.map((item) => ({
        photo: item.photo,
        width: item.ratio * height,
      })),
    }
  })

  return { rows }
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
  const clampRowHeights = options.clampRowHeights !== false

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
  // If min/max constraints conflict, relax min-per-row to preserve min tile width.
  const clampedMaxPerRow = allowedMaxPerRow
  const clampedMinPerRow = Math.min(allowedMinPerRow, clampedMaxPerRow)
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
  let laidOutTileWidthSum = 0
  let laidOutTileCount = 0
  let cursor = 0

  const getFittedRowHeight = (chunk, gap) => {
    const ratioSum = chunk.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
    const rowWidth = width - gap * (chunk.length - 1)
    return rowWidth / ratioSum
  }

  const minTileWidthInRow = (chunk, rowHeight) => {
    let minWidth = Number.POSITIVE_INFINITY
    for (const item of chunk) {
      const tileWidth = item.ratio * rowHeight
      if (tileWidth < minWidth) {
        minWidth = tileWidth
      }
    }
    return Number.isFinite(minWidth) ? minWidth : 0
  }

  while (cursor < items.length) {
    const remaining = items.length - cursor
    const maxCountForRow = Math.min(clampedMaxPerRow, remaining)
    let chosenCount = Math.min(targetPerRow, maxCountForRow)

    while (chosenCount > 1) {
      const chunk = items.slice(cursor, cursor + chosenCount)
      const rowHeight = getFittedRowHeight(chunk, previewGap)
      if (minTileWidthInRow(chunk, rowHeight) >= minTileWidth) {
        break
      }
      chosenCount -= 1
    }

    const chunk = items.slice(cursor, cursor + chosenCount)
    const isSingleRowTile = chosenCount === 1
    const isLastRow = cursor + chosenCount >= items.length
    const gap = isSingleRowTile ? 0 : previewGap
    const fittedHeight = getFittedRowHeight(chunk, gap)

    let rowHeight = fittedHeight
    if (isLastRow) {
      const averageHeight = fullRowHeights.length
        ? fullRowHeights.reduce((sum, value) => sum + value, 0) / fullRowHeights.length
        : targetRowHeight
      const desiredTailHeight = stretchLastRow
        ? fittedHeight
        : Math.min(fittedHeight, averageHeight)

      rowHeight = clampRowHeights
        ? Math.max(minRowHeight, Math.min(maxRowHeight, desiredTailHeight))
        : desiredTailHeight

      if (isSingleRowTile) {
        const ratio = chunk[0]?.ratio || 1
        const averageTileWidth = laidOutTileCount > 0
          ? (laidOutTileWidthSum / laidOutTileCount)
          : Math.min(maxTileWidth, width)
        const targetTileWidth = Math.min(
          Math.max(minTileWidth, averageTileWidth),
          maxTileWidth,
        )
        rowHeight = Math.max(1, Math.min(width, targetTileWidth)) / ratio
      }
    } else {
      fullRowHeights.push(rowHeight)
    }

    const tiles = chunk.map((item) => ({
      photo: item.photo,
      width: item.ratio * rowHeight,
    }))

    rows.push({
      gap,
      height: rowHeight,
      tiles,
    })

    tiles.forEach((tile) => {
      laidOutTileWidthSum += tile.width
      laidOutTileCount += 1
    })

    cursor += chosenCount
  }

  return { rows }
}
