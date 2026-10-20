import axios from 'axios'
import { showImagePreview } from 'vant'
import { get } from 'lodash-es'
import { blobToJson } from '~/utils/DataUtils.js'

const getAttachment = async (url) => {
  const response = await axios.get(url, { responseType: 'blob' })
  if (!ResponseUtils.isSuccess(response)) {
    const responseBody = await blobToJson(response.data)
    const errorMessage = get(responseBody, 'message') ?? 'Error occurred'
    UIUtils.showToastError(errorMessage)
    return
  }

  return response.data
}

const download = (data, filename = 'filename.pdf') => {
  try {
    const blob = new Blob([data])
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()

    a.remove()
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Download failed:', error)
  }
}

export const getAttachmentObjectUrl = async (url) => {
  const attachment = await getAttachment(url)
  return attachment ? URL.createObjectURL(attachment) : null
}

export const showImageFromUrl = async (url) => {
  const blobUrl = await getAttachmentObjectUrl(url)
  if (!blobUrl) {
    return
  }
  showImagePreview({ images: [blobUrl], closeable: true, onClose: () => URL.revokeObjectURL(blobUrl) })
}

export const downloadFileFromUrl = async (url, filename) => {
  let attachment = await getAttachment(url)
  if (!attachment) {
    return
  }

  download(attachment, filename)
}
