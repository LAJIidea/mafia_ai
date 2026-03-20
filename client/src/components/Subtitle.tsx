interface Props {
  text: string;
}

export default function Subtitle({ text }: Props) {
  return (
    <div className="subtitle-bar text-center text-white font-bold">
      {text}
    </div>
  );
}
