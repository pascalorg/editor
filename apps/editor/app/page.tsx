import Editor from '../components/editor'

export default function Home() {
  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor />
      </div>
    </div>
  )
}
