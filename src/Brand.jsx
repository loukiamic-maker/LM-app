export default function Brand({ onClick, className = '' }) {
  const content = <><img src={`${import.meta.env.BASE_URL}images/eneres-flower.png`} alt="" /><span>Eneres</span></>;
  return onClick ? <button className={`brand eneres-brand ${className}`} onClick={onClick} aria-label="Eneres — Αρχική">{content}</button> : <span className={`brand eneres-brand ${className}`}>{content}</span>;
}
